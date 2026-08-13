/**
 * Game feel, asserted rather than admired.
 *
 *   npm run check:feel
 *
 * Everything here is feedback on an action the player already performs, and all
 * of it is invisible to a screenshot — a recoil pattern, a hitch on contact, a
 * spark that should not be there on plaster. That combination is how this sort
 * of work rots: it is added once, quietly broken by an unrelated change, and
 * nobody notices because nothing throws.
 *
 * So each one gets a number.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

let bad = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? ' ✓' : ' ✗'} ${label}${extra ? '  ' + extra : ''}`);
};

const out = await page.evaluate(async () => {
  const g = window.__game;
  const { Agent } = await import('/src/entities/ai.js');
  g.selected.operator = 'kite';
  g.settings.intro = false;
  g.startRun();
  g._tick(1 / 60);
  const p = g.player;
  const res = {};

  /* ── the recoil pattern ── */
  const burst = (n) => {
    const w = p.weapon;
    w.resetPattern();
    p.yaw = 0; p.pitch = 0; p.recoilPitch = 0; p.recoilYaw = 0;
    const path = [];
    for (let i = 0; i < n; i++) {
      const pat = w.pattern(i);
      path.push([+pat.up.toFixed(5), +pat.side.toFixed(5)]);
    }
    return path;
  };
  const a = burst(20);
  const b = burst(20);
  res.repeatable = JSON.stringify(a) === JSON.stringify(b);
  // it should climb, and it should wander sideways rather than going straight up
  res.climb = a.every((s) => s[0] > 0);
  res.sideSpan = +(Math.max(...a.map((s) => s[1])) - Math.min(...a.map((s) => s[1]))).toFixed(3);
  // and it must not be the same every shot, or it is a constant, not a pattern
  res.distinct = new Set(a.map((s) => s[1].toFixed(4))).size;

  /* ── surface-keyed impacts ── */
  const sparksFor = (tag) => {
    const before = g.combat.puffs.filter((q) => q.mesh.visible && q.kind === 'spark').length;
    g.combat.impact(new (p.pos.constructor)(0, 100, 0), new (p.pos.constructor)(0, 1, 0), tag);
    return g.combat.puffs.filter((q) => q.mesh.visible && q.kind === 'spark').length - before;
  };
  for (const q of g.combat.puffs) { q.mesh.visible = false; q.life = 99; }
  res.sparksMetal = sparksFor('vehicle');
  for (const q of g.combat.puffs) { q.mesh.visible = false; q.life = 99; }
  res.sparksConcrete = sparksFor('building');

  /*
   * ── the hitch on contact ──
   *
   * A dummy of our own: the run opens on the intermission before wave one, so
   * there is nothing alive to shoot yet and looking for a hostile finds none.
   */
  const arch = { id: 'dummy', name: 'Dummy', weapon: 'pistol', health: 1e6, armor: 0,
    speed: 0, skill: 0, score: 0, rank: 'grunt' };
  const spot = p.pos.clone(); spot.z -= 8;
  const enemy = new Agent(g, arch, g.enemyFaction, spot);
  g.agents.push(enemy);
  if (enemy) {
    g._hitstop = 0;
    g.applyDamage(enemy, 5, p, 'body', enemy.pos.clone());
    res.hitstopOnHit = +(g._hitstop || 0).toFixed(3);
  }

  /* ── the weapon is not welded to the hand ── */
  const m = p.model.weaponModel;
  if (m) {
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      g.input.keys.add('KeyW');
      g._tick(1 / 60);
      seen.add(`${m.position.x.toFixed(4)},${m.position.y.toFixed(4)}`);
    }
    g.input.keys.delete('KeyW');
    res.swayStates = seen.size;
  }
  return res;
});

console.log('\n── recoil ──');
ok('the pattern is the same every burst', out.repeatable);
ok('it climbs', out.climb);
ok('it drifts sideways rather than straight up', out.sideSpan > 0.2, `span ${out.sideSpan}`);
ok('and it is a pattern, not one constant', out.distinct > 6, `${out.distinct} distinct offsets in 20`);

console.log('\n── impacts ──');
ok('metal sparks', out.sparksMetal > 0, `${out.sparksMetal} sparks`);
ok('masonry does not', out.sparksConcrete === 0, `${out.sparksConcrete} sparks`);

console.log('\n── contact ──');
ok('a non-fatal hit hitches the frame', out.hitstopOnHit > 0, `${out.hitstopOnHit}s`);

console.log('\n── the weapon in the hand ──');
ok('the weapon sways rather than sitting welded', out.swayStates > 10,
  `${out.swayStates} distinct offsets over 40 frames`);

console.log(bad ? `\n${bad} failure(s)` : '\nit has weight');
await browser.close();
process.exit(bad ? 1 : 0);
