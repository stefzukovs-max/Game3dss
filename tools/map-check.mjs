import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 120000 });
await page.evaluate(() => window.__game.startRun());
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => { for (let k = 0; k < 600; k++) window.__game._tick(1 / 60); });
}

const info = await page.evaluate(() => {
  const g = window.__game;
  const nav = g.nav;
  const col = g.world.collision;
  const V = g.player.pos.constructor;
  const f = (n) => +n.toFixed(1);
  const nodeStr = (i) => {
    const n = nav.nodes[i];
    return `#${i}:${n.kind}T${n.t}(${f(n.pos.x)},${f(n.pos.y)},${f(n.pos.z)})${n.blocked ? 'X' : ''}`;
  };

  const out = { player: [g.player.pos.x, g.player.pos.y, g.player.pos.z].map(f), agents: [] };

  for (const a of g.agents) {
    if (!a.alive || a.faction === g.playerFaction) continue;
    // reproduce the steer decision for this agent
    const obj = g.objectiveFor(a);
    const from = nav.nearest(a.pos, nav.constructor.terraceOf(a.pos.z));
    const to = nav.nearest(obj, nav.constructor.terraceOf(obj.z));
    const path = nav.path(from, to);
    out.agents.push({
      pos: [a.pos.x, a.pos.y, a.pos.z].map(f),
      state: a.state, stuck: +a.stuckTimer.toFixed(2), avoid: +(a._avoidAngle || 0).toFixed(2),
      vel: [a.vel.x, a.vel.z].map((n) => +n.toFixed(2)),
      from: nodeStr(from), to: nodeStr(to),
      idx: a.pathIdx, len: a.path ? a.path.length : null,
      cur: a.path && a.path[a.pathIdx] != null ? nodeStr(a.path[a.pathIdx]) : null,
      freshPath: path ? path.slice(0, 5).map(nodeStr) : null,
    });
  }

  // Can an agent standing at the foot of each climb actually walk up it?
  out.climbs = [];
  for (const n of nav.nodes) {
    if (n.kind !== 'climb-bottom') continue;
    // march uphill from the bottom node the way the AI would
    let y = col.groundHeight(n.pos.x, n.pos.z, n.pos.y + 2, 0.45);
    let ok = true, failAt = null;
    for (let d = 0.3; d <= 14; d += 0.3) {
      const pz = n.pos.z - d;
      const gh = col.groundHeight(n.pos.x, pz, y + 0.45, 0.28);
      if (gh < y - 3.2) { ok = false; failAt = `drop@${f(pz)} y=${f(y)}`; break; }
      if (col.isBlocked(n.pos.x, gh, pz, 0.28, 1.55, 0.63)) {
        // identify the culprit
        const idx = [];
        col.query(n.pos.x - 0.34, pz - 0.34, n.pos.x + 0.34, pz + 0.34, idx);
        let who = '?';
        for (const bi of idx) {
          const b = col.boxes[bi];
          if (b.off || b.y1 <= gh + 0.63 || b.y0 >= gh + 1.55) continue;
          const cxx = Math.max(b.x0, Math.min(n.pos.x, b.x1));
          const czz = Math.max(b.z0, Math.min(pz, b.z1));
          if ((n.pos.x - cxx) ** 2 + (pz - czz) ** 2 >= 0.28 * 0.28) continue;
          who = `${b.tag}[x${f(b.x0)}..${f(b.x1)} y${f(b.y0)}..${f(b.y1)} z${f(b.z0)}..${f(b.z1)}]`;
          break;
        }
        ok = false; failAt = `block@${f(pz)} g=${f(gh)} by ${who}`; break;
      }
      y = gh;
    }
    out.climbs.push(`x=${f(n.pos.x)} z=${f(n.pos.z)} y0=${f(n.pos.y)} -> ${ok ? 'CLIMBABLE y=' + f(y) : 'FAIL ' + failAt}`);
  }
  out.blockedNodes = nav.nodes.filter((n) => n.blocked).length;
  return out;
});

console.log('player', info.player, 'blockedNodes', info.blockedNodes);
console.log('\n── agents ──');
for (const a of info.agents) console.log(JSON.stringify(a));
console.log('\n── climb walkability from each bottom waypoint ──');
for (const c of info.climbs) console.log(' ', c);
await browser.close();
