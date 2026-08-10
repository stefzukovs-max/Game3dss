/**
 * Weapon bench.
 *
 * Isolates the player: every other combatant is removed, the player is pinned
 * healthy and facing a stationary dummy on open ground, and we measure the
 * PLAYER's own damage output (never the dummy's health, which allied fire
 * would swamp).
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', e.stack));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

const out = await page.evaluate(async () => {
  const g = window.__game;
  const log = [];
  const { Agent } = await import('/src/entities/ai.js');

  g.selected.operator = 'pipa';           // SMG primary
  g.startRun();
  g._tick(1 / 60);

  const p = g.player;
  const V = p.pos.constructor;

  /**
   * Clear the field and stand the player in the middle of the plaza - the one
   * genuinely open stretch on the map. Benching among the houses measures how
   * often the cone clips a wall, not how accurate the weapon is.
   */
  const reset = () => {
    for (const a of g.agents) a.dispose();
    g.agents.length = 0;
    p.alive = true;
    p.health = 10000;
    p.pos.set(18, 0, 58);
    p.pos.y = g.world.collision.groundHeight(p.pos.x, p.pos.z, 3, 0.5);
    p.yaw = 0; p.pitch = 0;
    p.vel.set(0, 0, 0);
    p.crouching = false;
    for (let i = 0; i < 4; i++) { p.updateCamera(g.camera, 1 / 60, g.world.collision); }
  };

  const arch = { id: 'dummy', name: 'Dummy', weapon: 'pistol', health: 1e6, armor: 0,
    speed: 0, skill: 0, score: 0, rank: 'grunt' };

  /**
   * @returns damage the player personally dealt over `secs` of held trigger.
   */
  const bench = (dist, { aiming = false, crouch = false, assist = true, weapon = 'smg', secs = 4 } = {}) => {
    reset();
    g.settings.assist = assist;
    p.switchTo(weapon);
    if (crouch) g.input.keys.add('ControlLeft'); else g.input.keys.delete('ControlLeft');

    const spot = new V(p.pos.x, p.pos.y, p.pos.z - dist);
    spot.y = g.world.collision.groundHeight(spot.x, spot.z, p.pos.y + 3, 0.5);
    const d = new Agent(g, arch, g.enemyFaction, spot);
    d.skill = 0;                      // never shoots back
    g.agents.push(d);

    /*
     * Put the CROSSHAIR on the target, which is what a player does. The
     * camera sits behind and to one side, so simply pointing the player's
     * body at the dummy leaves the crosshair beside it. The camera position
     * depends on yaw, so solve it by iterating a few times.
     */
    const tgt = new V(spot.x, spot.y + 1.25, spot.z);
    for (let k = 0; k < 6; k++) {
      p.updateCamera(g.camera, 1 / 60, g.world.collision);
      const dir = tgt.clone().sub(g.camera.position).normalize();
      p.yaw = Math.atan2(-dir.x, -dir.z);
      p.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    }
    p.updateCamera(g.camera, 1 / 60, g.world.collision);
    const clear = !g.world.collision.losBlocked(g.camera.position, tgt);

    const before = p.damageDealt;
    let shots = 0;
    const w = p.weapon;
    w.bloom = 0;
    g.input.buttons[2] = aiming;
    for (let i = 0; i < secs * 60; i++) {
      w.reserve = 99999;
      if (w.mag <= 0) { w.mag = w.def.mag; w.reloading = false; }
      // semi-autos need the trigger released between shots
      g.input.buttons[0] = w.def.auto ? true : i % 4 < 2;
      const magBefore = w.mag;
      p.alive = true; p.health = 10000;
      g._tick(1 / 60);
      if (w.mag < magBefore) shots += magBefore - w.mag;
    }
    g.input.buttons[0] = false;
    g.input.buttons[2] = false;
    g.input.keys.delete('ControlLeft');

    const dealt = p.damageDealt - before;
    return { dealt: Math.round(dealt), shots, clear, perShot: shots ? +(dealt / shots).toFixed(1) : 0 };
  };

  const show = (label, r) =>
    log.push(`${label.padEnd(34)} ${String(r.dealt).padStart(5)} dmg over ${String(r.shots).padStart(3)} shots` +
      `  (${r.perShot}/shot)${r.clear ? '' : '  [LOS BLOCKED - ignore]'}`);

  show('SMG  12m hipfire', bench(12, { aiming: false }));
  show('SMG  12m ADS', bench(12, { aiming: true }));
  show('SMG  12m ADS, no aim assist', bench(12, { aiming: true, assist: false }));
  show('SMG  30m hipfire', bench(30, { aiming: false }));
  show('SMG  30m ADS', bench(30, { aiming: true }));
  show('SMG  30m ADS crouched', bench(30, { aiming: true, crouch: true }));
  show('PISTOL 12m ADS', bench(12, { aiming: true, weapon: 'pistol' }));
  show('PISTOL 12m ADS, no assist', bench(12, { aiming: true, weapon: 'pistol', assist: false }));

  return log;
});

for (const l of out) console.log(' ', l);
await browser.close();
