/**
 * Mobile verification: emulates a phone (touch, DPR, landscape + portrait) and
 * drives the game through synthetic touch events — stick, look drag and the
 * on-screen buttons — checking each one actually reaches the simulation.
 */
import { chromium, devices } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const phone = {
  ...devices['iPhone 12'],
  viewport: { width: 844, height: 390 },     // landscape
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};
const ctx = await browser.newContext(phone);
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' | ' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

const ok = (label, cond, extra = '') =>
  console.log(`${cond ? ' ✓' : ' ✗'} ${label}${extra ? '  ' + extra : ''}`);

/* ── device detection ── */
const det = await page.evaluate(() => ({
  isTouch: window.__game.input.isTouch,
  bodyClass: document.body.className,
  touchVisible: !document.getElementById('touch').classList.contains('hidden'),
  quality: window.__game.quality,
  pixelRatio: window.__game.renderer.getPixelRatio(),
  shadows: window.__game.renderer.shadowMap.enabled,
  maxEnemies: window.__game.maxEnemies,
  fogFar: window.__game.scene.fog.far,
  fov: window.__game.camera.fov,
}));
ok('touch device detected', det.isTouch);
ok('is-touch class applied', det.bodyClass.includes('is-touch'));
ok('touch controls shown', det.touchVisible);
ok('quality auto-tiered', !!det.quality, `→ ${det.quality} · dpr ${det.pixelRatio} · shadows ${det.shadows} · fog ${det.fogFar} · cap ${det.maxEnemies}`);

/* ── mobile menu legibility ── */
await page.screenshot({ path: `${OUT}/mob-1-menu.png` });
const overflow = await page.evaluate(() => {
  const s = document.getElementById('scr-menu');
  return { scrollW: s.scrollWidth, clientW: s.clientWidth, bodyScroll: document.body.scrollWidth > innerWidth + 1 };
});
ok('menu fits the viewport', !overflow.bodyScroll && overflow.scrollW <= overflow.clientW + 2,
  JSON.stringify(overflow));

/* ── start a run: no pointer lock should be involved ── */
await page.tap('#btn-play');
// the opening plays first on a fresh session; skipping it is part of the path
// a real player takes, so the check goes through it rather than around it
await page.waitForTimeout(600);
const sawIntro = await page.evaluate(() => !!document.querySelector('.cut'));
if (sawIntro) {
  await page.tap('.cut-skip');
  await page.waitForTimeout(700);
}
ok('opening plays, and skips', sawIntro);
await page.waitForTimeout(700);
const started = await page.evaluate(() => ({
  state: window.__game.state,
  overlayGone: document.getElementById('overlay').classList.contains('gone'),
  hudVisible: !document.getElementById('hud').classList.contains('hidden'),
}));
ok('run starts straight into play (no lock card)', started.state === 'playing' && started.overlayGone,
  JSON.stringify(started));
ok('HUD visible', started.hudVisible);

/* ── synthetic multi-touch: steer with the left thumb, look with the right ── */
const touchDrive = async (steps) => page.evaluate(async (list) => {
  const fire = (type, touches) => {
    const t = touches.map((p) => new Touch({
      identifier: p.id, target: document.elementFromPoint(p.x, p.y) || document.body,
      clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y,
    }));
    const ev = new TouchEvent(type, {
      touches: t, targetTouches: t, changedTouches: t, bubbles: true, cancelable: true,
    });
    (document.elementFromPoint(touches[0].x, touches[0].y) || document.body).dispatchEvent(ev);
  };
  for (const s of list) { fire(s.type, s.touches); await new Promise((r) => setTimeout(r, 16)); }
}, steps);

const before = await page.evaluate(() => ({
  x: window.__game.player.pos.x, z: window.__game.player.pos.z, yaw: window.__game.player.yaw,
}));

// left thumb down at (120, 300), push forward; right thumb drags to look
const seq = [{ type: 'touchstart', touches: [{ id: 1, x: 120, y: 300 }] }];
for (let i = 1; i <= 18; i++) seq.push({ type: 'touchmove', touches: [{ id: 1, x: 120, y: 300 - i * 4 }] });
// sample peak speed rather than net displacement: the player can spawn
// facing a wall, in which case they legitimately go nowhere while the stick
// is working perfectly well
await touchDrive(seq);
// Pump the simulation at a fixed step. Under software rendering the real
// frame loop crawls, so anything measured against wall-clock reports the
// renderer's speed rather than whether the stick is wired up.
const moved = await page.evaluate(() => {
  const g = window.__game;
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    g._tick(1 / 60);
    peak = Math.max(peak, Math.hypot(g.player.vel.x, g.player.vel.z));
  }
  return {
    x: g.player.pos.x, z: g.player.pos.z,
    mx: g.input.touch.mx, my: g.input.touch.my,
    sprint: g.input.keys.has('ShiftLeft'), peak,
  };
});
ok('stick drives movement', moved.my > 0.9 && moved.peak > 2,
  `peak ${moved.peak.toFixed(1)} m/s · axis ${moved.my.toFixed(2)} · sprint ${moved.sprint}` +
  ` · net ${Math.hypot(moved.x - before.x, moved.z - before.z).toFixed(2)} m`);

await touchDrive([{ type: 'touchend', touches: [{ id: 1, x: 120, y: 228 }] }]);

// look drag on the right side
const look = [{ type: 'touchstart', touches: [{ id: 2, x: 600, y: 160 }] }];
for (let i = 1; i <= 14; i++) look.push({ type: 'touchmove', touches: [{ id: 2, x: 600 + i * 9, y: 160 }] });
look.push({ type: 'touchend', touches: [{ id: 2, x: 726, y: 160 }] });
await touchDrive(look);
// same fixed-step pump: the accumulated look delta is consumed inside _tick
const looked = await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 10; i++) g._tick(1 / 60);
  return g.player.yaw;
});
ok('right-thumb drag turns the camera', Math.abs(looked - before.yaw) > 0.15,
  `Δyaw ${(looked - before.yaw).toFixed(2)} rad`);

/* ── buttons ── */
const tapBtn = async (id) => {
  const box = await page.locator('#' + id).boundingBox();
  if (!box) return false;
  await touchDrive([
    { type: 'touchstart', touches: [{ id: 9, x: box.x + box.width / 2, y: box.y + box.height / 2 }] },
    { type: 'touchend', touches: [{ id: 9, x: box.x + box.width / 2, y: box.y + box.height / 2 }] },
  ]);
  return true;
};

const magBefore = await page.evaluate(() => window.__game.player.weapon.mag);
const fb = await page.locator('#btn-fire').boundingBox();
await touchDrive([{ type: 'touchstart', touches: [{ id: 5, x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 }] }]);
// Hold the trigger across a fixed-step pump rather than a wall-clock wait.
// The last of these to be left on real time, and it broke the moment the
// scene got heavy enough that 700 ms no longer contained a simulation tick
// under software rendering.
const magAfter = await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 45; i++) g._tick(1 / 60);
  return g.player.weapon.mag;
});
await touchDrive([{ type: 'touchend', touches: [{ id: 5, x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 }] }]);
ok('FIRE button shoots', magAfter !== magBefore, `mag ${magBefore} → ${magAfter}`);

await tapBtn('btn-aim');
await page.waitForTimeout(200);
ok('AIM toggles', await page.evaluate(() => window.__game.input.touch.aim));
await tapBtn('btn-aim');

await page.evaluate(() => { window.__game.player.vel.y = 0; window.__game.player.onGround = true; });
await tapBtn('btn-jump');
ok('JUMP registers', await page.evaluate(() => {
  const g = window.__game;
  g._tick(1 / 60);                       // the tick that consumes the press
  return g.player.vel.y > 1 || !g.player.onGround;
}));

const cdBefore = await page.evaluate(() => window.__game.player.abilityCd);
await tapBtn('btn-ability');
ok('ability button fires', await page.evaluate((b) => {
  const g = window.__game;
  for (let i = 0; i < 6; i++) g._tick(1 / 60);
  return g.player.abilityCd > b;
}, cdBefore));

const nadeBefore = await page.evaluate(() => window.__game.player.grenades);
await tapBtn('btn-nade');
// same fixed-step pump as the jump check: the press is consumed inside _tick,
// and under software rendering a wall-clock wait can pass without one running
ok('grenade button throws', await page.evaluate((b) => {
  const g = window.__game;
  for (let i = 0; i < 6; i++) g._tick(1 / 60);
  return g.player.grenades < b;
}, nadeBefore));

await tapBtn('btn-crouch');
// and again: crouch is applied inside _tick, so pump rather than wait
ok('crouch toggles', await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 6; i++) g._tick(1 / 60);
  return g.player.crouching;
}));
await tapBtn('btn-crouch');

await page.screenshot({ path: `${OUT}/mob-2-hud.png` });

await tapBtn('btn-pause');
await page.waitForTimeout(300);
ok('pause button pauses', await page.evaluate(() => window.__game.state === 'paused'));
await page.screenshot({ path: `${OUT}/mob-3-pause.png` });

/* ── portrait gate ──
 * Waiting on the condition rather than a fixed delay. The resize handler
 * rebuilds the post-processing chain, which under software rendering can take
 * well over half a second — a sleep long enough to be safe today stops being
 * safe the moment the scene gets heavier, which is exactly what happened.
 */
const gateShown = (want) => page.waitForFunction(
  (w) => document.getElementById('rotate-gate').classList.contains('hidden') !== w,
  want, { timeout: 15000 }).then(() => true, () => false);

await page.setViewportSize({ width: 390, height: 844 });
ok('portrait shows the rotate gate', await gateShown(true));
await page.screenshot({ path: `${OUT}/mob-4-portrait.png` });
await page.setViewportSize({ width: 844, height: 390 });
ok('landscape hides it again', await gateShown(false));

/*
 * Deliberately not reporting a render-cost number here. Under swiftshader
 * everything is CPU-bound, and switching between the composer and a direct
 * canvas render flips three's tone-mapping define, forcing a full shader
 * recompile — so any timing taken across the two paths measures compilation,
 * not frame cost. Real GPU numbers need real hardware.
 */
console.log(`\nERRORS (${errors.length})`);
for (const e of errors.slice(0, 10)) console.log('  •', e);
await browser.close();
process.exit(errors.length ? 1 : 0);
