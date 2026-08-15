/**
 * Look at the game.
 *
 *   npm run look                  four views, into ./looks/
 *   npm run look -- plaza         just one
 *
 * A working loop for art direction, not a regression test. Every other
 * harness in here drives the game to prove something specific; this one
 * exists so a change to the palette, the lighting or the build can be judged
 * by eye in twenty seconds without playing through to find a good angle.
 *
 * It uses the game's own third-person camera at the game's own field of view,
 * because a flattering bespoke camera is how you convince yourself a look is
 * working when it is not.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || 'looks';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];

/*
 * Four places, chosen to cover the range the art has to hold up across:
 * open ground in full sun, a tight alley, a long downhill sightline, and a
 * crowd of characters close enough to read faces.
 */
const VIEWS = [
  /*
   * Yaw 0 is up the hill — the game's forward is −Z, so this is the direction
   * the player spends the whole run looking in. Pointing these the other way
   * frames the boundary wall at the bottom of the map, which is a fine
   * photograph of something nobody looks at.
   */
  { name: 'plaza',  x: 6,   z: 50,  yaw: 0,              crowd: 0 },
  /*
   * A lane with a sightline, not the tightest spot on the map. x=19,z=13 is
   * fully covered — six walls and a roof — which is a fine place to test
   * reverb and a useless place to photograph, because the third-person
   * camera sits inside the wall behind you and the frame comes back black.
   */
  { name: 'alley',  x: -44, z: 2,   yaw: 0,              crowd: 0 },
  { name: 'summit', x: 2,   z: -52, yaw: 0,              crowd: 0 },
  { name: 'crowd',  x: 6,   z: 44,  yaw: 0,              crowd: 5 },
  /*
   * Close on the player. Character work — proportions, the weapon in the
   * hand, whether anything is poking through a shoulder — cannot be judged
   * from a gameplay camera eight metres back, and cropping a gameplay shot
   * gives you eight pixels of face.
   */
  { name: 'hero',   x: 6,   z: 50,  yaw: 0,   crowd: 0, close: true },
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

await page.evaluate((op) => {
  const g = window.__game;
  g.selected.operator = op;
  g.settings.intro = false;
  g.startRun();
  g._tick(1 / 60);
  document.getElementById('overlay')?.classList.add('gone');
}, process.env.OP || 'kite');

for (const v of VIEWS) {
  if (only && v.name !== only) continue;
  await page.evaluate(async (view) => {
    const g = window.__game;
    const p = g.player;
    const V = p.pos.constructor;
    const { TERRACES } = await import('/src/world/favela.js');
    const { Agent } = await import('/src/entities/ai.js');
    const { GRUNTS } = await import('/src/entities/roster.js');

    for (const a of g.agents) a.dispose();
    g.agents.length = 0;

    const terr = TERRACES.find((t) => view.z >= t.z0 && view.z <= t.z1) ?? TERRACES[0];
    const spot = new V(view.x, g.world.collision.groundHeight(view.x, view.z, terr.y + 2.4, 0.5), view.z);
    p.spawnAt(spot);
    p.yaw = view.yaw; p.pitch = 0;
    p.health = 1e6;

    /*
     * A crowd of the enemy faction, stood in front of the player rather than
     * spawned into the wave — the point is to see five silhouettes at once,
     * not to wait for the AI to walk into shot.
     */
    /*
     * In front of the camera, using the game's own forward convention:
     * yaw 0 faces −Z, so forward is (−sin yaw, 0, −cos yaw). Getting this
     * wrong once already put five characters behind the player's back and
     * produced a very well-lit photograph of an empty plaza.
     */
    const fwd = new V(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    const right = new V(-fwd.z, 0, fwd.x);
    const pool = GRUNTS[g.enemyFaction] ?? [];
    for (let i = 0; i < view.crowd && i < pool.length; i++) {
      const s = new V(view.x, 0, view.z)
        .addScaledVector(fwd, 8).addScaledVector(right, (i - 2) * 1.7);
      s.y = g.world.collision.groundHeight(s.x, s.z, terr.y + 2.4, 0.5);
      const a = new Agent(g, pool[i], g.enemyFaction, s);
      a.yaw = view.yaw + Math.PI;
      a.model.update(0.4, { speed: 0, aiming: i % 2 === 1, crouching: false, pitch: 0, dead: false });
      g.agents.push(a);
    }

    // settle the spring-arm camera rather than snapping it
    for (let i = 0; i < 40; i++) {
      p.updateCamera(g.camera, 1 / 60, g.world.collision);
      for (const a of g.agents) a.model.update(1 / 60, { speed: 0, aiming: false, crouching: false, pitch: 0, dead: false });
    }
    if (view.close) {
      const head = new V();
      let hb = null; p.model.root.traverse((o) => { if (o.name === 'Head') hb = o; });
      p.model.root.updateMatrixWorld(true);
      if (hb) hb.getWorldPosition(head); else head.copy(p.pos).setY(p.pos.y + 1.5);
      g.camera.position.set(head.x + 1.9, head.y - 0.15, head.z + 1.9);
      g.camera.lookAt(head.x, head.y - 0.55, head.z);
      g.camera.fov = 34; g.camera.updateProjectionMatrix();
    }
    g._updateSun();
    if (g.skyDome) g.skyDome.position.copy(g.camera.position);
    g.renderFrame(1 / 60);
  }, v);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${v.name}.png` });
  console.log(`  ${OUT}/${v.name}.png`);
}

await browser.close();
