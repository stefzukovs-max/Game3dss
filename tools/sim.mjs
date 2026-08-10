/**
 * Headless simulation harness: drives the game at a fixed timestep so the AI,
 * wave director and combat run at full speed regardless of render framerate.
 *   node sim.mjs [minutes]
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const MINUTES = Number(process.argv[2] || 4);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 120000 });

// pick an operator + start
const OP = process.env.OP || 'kite';
await page.evaluate((op) => {
  const g = window.__game;
  g.selected.operator = op;
  g.selected.faction = window.__roster ? 'gang' : g.selected.faction;
  g.startRun();
}, OP);
await page.waitForTimeout(400);
await page.evaluate((v) => { window.__autoplay = v; }, process.env.AUTOPLAY !== '0');

const TICKS = Math.round(MINUTES * 60 * 60);
const CHUNK = 600;
let done = 0;
const marks = [];

while (done < TICKS) {
  const r = await page.evaluate((chunk) => {
    const g = window.__game;
    const errs = [];
    for (let i = 0; i < chunk; i++) {
      try {
        if (window.__autoplay && g.player && g.player.alive) {
          // aim at the nearest hostile with line of sight and hold the trigger
          let best = null, bd = Infinity;
          for (const a of g.agents) {
            if (!a.alive || a.faction === g.playerFaction) continue;
            const d = a.pos.distanceTo(g.player.pos);
            if (d < bd) { bd = d; best = a; }
          }
          if (best && bd < 70) {
            g.player.yaw = Math.atan2(-(best.pos.x - g.player.pos.x), -(best.pos.z - g.player.pos.z));
            const flat = Math.hypot(best.pos.x - g.player.pos.x, best.pos.z - g.player.pos.z);
            g.player.pitch = Math.atan2((best.pos.y + 1.3) - (g.player.pos.y + 1.6), flat);
            g.input.buttons[0] = true;
          } else {
            g.input.buttons[0] = false;
          }
        }
        g._tick(1 / 60);
      } catch (e) { errs.push(e.message + ' | ' + (e.stack || '').split('\n')[1]); if (errs.length > 3) break; }
    }
    const enemies = g.agents.filter((a) => a.alive && a.faction === g.enemyFaction);
    const allies = g.agents.filter((a) => a.alive && a.faction === g.playerFaction);
    let closest = Infinity;
    for (const e of enemies) closest = Math.min(closest, e.pos.distanceTo(g.player.pos));
    // how far up/down the hill have enemies travelled?
    const terraces = enemies.map((e) => e.pos.z);
    return {
      errs,
      state: g.state, wave: g.waves.wave, phase: g.waves.phase,
      enemies: enemies.length, allies: allies.length, corpses: g.agents.length - enemies.length - allies.length,
      hp: Math.round(g.player.health), armor: Math.round(g.player.armor),
      kills: g.player.kills, deaths: g.player.deaths, score: g.score, revives: g.revives,
      closest: isFinite(closest) ? +closest.toFixed(1) : null,
      minZ: terraces.length ? +Math.min(...terraces).toFixed(0) : null,
      maxZ: terraces.length ? +Math.max(...terraces).toFixed(0) : null,
      py: +g.player.pos.y.toFixed(1),
      pickups: g.pickups.items.length,
      projectiles: g.abilities.projectiles.length,
      fires: g.abilities.fires.length,
      deployables: g.abilities.deployables.length,
      abilityCd: +g.player.abilityCd.toFixed(1),
    };
  }, CHUNK);
  done += CHUNK;
  if (r.errs.length) { errors.push(...r.errs); break; }
  marks.push({ t: (done / 60).toFixed(0) + 's', ...r });
  // the draft screen halts the sim - auto-pick a card so the run continues
  if (r.state === 'draft') {
    await page.evaluate(() => document.querySelector('#draft-cards .card')?.click());
  }
  if (r.state === 'dead') {
    await page.evaluate(() => window.__game.respawn());
  }
  if (r.state === 'over') break;
}

console.log('t      state   wave  phase        enemies allies corpse  hp  arm kills score  closest  zRange');
for (const m of marks) {
  if (+m.t.replace('s', '') % 20 !== 0 && m !== marks[marks.length - 1]) continue;
  console.log(
    String(m.t).padEnd(7) + String(m.state).padEnd(8) + String(m.wave).padEnd(6) +
    String(m.phase).padEnd(13) + String(m.enemies).padEnd(8) + String(m.allies).padEnd(7) +
    String(m.corpses).padEnd(8) + String(m.hp).padEnd(4) + String(m.armor).padEnd(4) +
    String(m.kills).padEnd(6) + String(m.score).padEnd(7) +
    String(m.closest).padEnd(9) + `${m.minZ}..${m.maxZ}`);
}

const last = marks[marks.length - 1];
console.log('\nfinal:', JSON.stringify(last));
console.log('\nERRORS (' + errors.length + '):');
for (const e of errors.slice(0, 12)) console.log(' •', e);

await page.screenshot({ path: OUT + '/sim-final.png' });
await browser.close();
process.exit(errors.length ? 1 : 0);
