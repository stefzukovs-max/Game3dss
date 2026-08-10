/** Focused check: does a player shot at a clearly-visible target deal damage? */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', e.stack));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 120000 });

const out = await page.evaluate(async () => {
  const g = window.__game;
  g.startRun();
  g._tick(1 / 60);

  const V = g.player.pos.constructor;
  const log = [];

  // put a dummy directly in front of the player on open ground
  const p = g.player;
  p.yaw = 0; p.pitch = 0;                       // facing -Z
  const spot = new V(p.pos.x, p.pos.y, p.pos.z - 12);
  spot.y = g.world.collision.groundHeight(spot.x, spot.z, p.pos.y + 3, 0.5);

  const { Agent } = await import('/src/entities/ai.js');
  const arch = { id: 'dummy', name: 'Dummy', weapon: 'pistol', health: 500, armor: 0,
    speed: 0, skill: 0, score: 10, rank: 'grunt' };
  const dummy = new Agent(g, arch, g.enemyFaction, spot);
  dummy.skill = 0;                              // never shoots back
  g.agents.push(dummy);

  // settle the camera
  for (let i = 0; i < 3; i++) { p.updateCamera(g.camera, 1 / 60, g.world.collision); }

  const eye = new V(p.pos.x, p.pos.y + 1.6, p.pos.z);
  const tgt = new V(dummy.pos.x, dummy.pos.y + 1.3, dummy.pos.z);
  log.push('dist=' + p.pos.distanceTo(dummy.pos).toFixed(1));
  log.push('LOS blocked from eye: ' + g.world.collision.losBlocked(eye, tgt));
  log.push('camera at ' + [g.camera.position.x, g.camera.position.y, g.camera.position.z]
    .map((n) => n.toFixed(1)).join(','));
  const cd = g.camera.getWorldDirection(new V());
  log.push('camera dir ' + [cd.x, cd.y, cd.z].map((n) => n.toFixed(2)).join(','));
  log.push('LOS blocked from camera: ' + g.world.collision.losBlocked(g.camera.position, tgt));

  const before = dummy.health;
  const dmgBefore = p.damageDealt;

  // hold the trigger for two seconds of game time
  g.input.buttons[0] = true;
  for (let i = 0; i < 120; i++) g._tick(1 / 60);
  g.input.buttons[0] = false;

  log.push(`dummy health ${before} -> ${dummy.health.toFixed(0)}`);
  log.push(`player damageDealt ${dmgBefore} -> ${p.damageDealt.toFixed(0)}`);
  log.push(`mag ${p.weapon.mag}/${p.weapon.def.mag} reserve ${p.weapon.reserve} reloading ${p.weapon.reloading}`);

  // and now check a kill registers
  dummy.health = 12;
  g.input.buttons[0] = true;
  for (let i = 0; i < 120; i++) g._tick(1 / 60);
  g.input.buttons[0] = false;
  log.push(`after finishing blow: alive=${dummy.alive} kills=${p.kills} score=${g.score}` +
    ` killedBy=${dummy._lastAttacker === p ? 'PLAYER' : (dummy._lastAttacker?.nameTag ?? 'none')}`);

  // hipfire vs ADS hit rate at 12 m, 40 shots each
  const trial = (aiming) => {
    const d2 = new Agent(g, { ...arch, health: 100000 }, g.enemyFaction,
      new V(p.pos.x, spot.y, p.pos.z - 12));
    d2.skill = 0; g.agents.push(d2);
    const h0 = d2.health;
    p.weapon.bloom = 0; p.weapon.mag = 400; p.weapon.reserve = 9999;
    g.input.buttons[2] = aiming;
    for (let i = 0; i < 240; i++) { p.weapon.reserve = 9999; p.weapon.mag = 400; g._tick(1 / 60); }
    g.input.buttons[2] = false;
    const dealt = h0 - d2.health;
    d2.alive = false; d2.model.dispose();
    return dealt;
  };
  log.push('4s sustained SMG damage — hipfire: ' + trial(false).toFixed(0));
  log.push('4s sustained SMG damage — ADS:     ' + trial(true).toFixed(0));

  return log;
});

for (const l of out) console.log(' ', l);
await browser.close();
