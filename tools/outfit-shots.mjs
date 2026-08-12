/**
 * Close-up character portraits, with an X-ray pass.
 *
 * The line-up shots in `character-shots.mjs` are how a player sees a
 * character; these are how the person fixing one has to. Half the defects
 * that matter — a garment that has slipped, a hem that cuts through an
 * ankle, a shell the body is poking through — are a few pixels at gameplay
 * distance and unmissable at two metres.
 *
 *   SKIN=0 hides the body, leaving only the clothing, which is the only
 *   reliable way to tell "the shirt is missing here" from "the shirt is here
 *   and the shoulder is coming through it".
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const SKIN = process.env.SKIN !== '0';
const CLOTH = process.env.CLOTH === '1';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:8080/', { waitUntil: 'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });
await p.evaluate((c) => { window.__cloth = c; }, CLOTH);

const shot = async (name, faction, { aiming, skin, turn = 0 }) => {
  await p.evaluate(async ([fac, aiming, skin, turn]) => {
    const g = window.__game;
    g.selected.faction = fac;
    g.selected.operator = fac === 'gang' ? 'boulder' : 'stone';
    g.settings.intro = false;
    if (g.state !== 'playing') g.startRun();
    g._tick(1 / 60);
    g.state = 'paused';
    document.getElementById('overlay').classList.add('gone');
    g.hud.show(false);

    for (const a of g.agents) a.dispose();
    g.agents.length = 0;

    const { Agent } = await import('/src/entities/ai.js');
    const { GRUNTS } = await import('/src/entities/roster.js');
    const V = g.player.pos.constructor;
    const base = g.player.pos.clone();
    base.y = g.world.collision.groundHeight(base.x, base.z, base.y + 3, 0.5);

    const a = new Agent(g, GRUNTS[fac][0], fac, new V(base.x, base.y, base.z - 4));
    a.yaw = Math.PI;
    a.model.root.rotation.y = turn;
    a.model.update(0.6, { speed: 0, aiming, crouching: false, pitch: 0, dead: false });
    g.agents.push(a);

    /*
     * The X-ray pass. `skin` drops the body; `cloth` additionally drops the
     * gear layer, which matters because the plate carrier rides over the
     * shoulders and will happily hide a hole in the shirt underneath it.
     */
    a.model.root.traverse((o) => {
      if (!o.isSkinnedMesh) { if (!window.__cloth && o.isMesh) o.visible = skin; return; }
      const named = /Superhero|Eyes|Hair/i.test(o.material?.name ?? '');
      if (named) o.visible = skin;
      else if (window.__cloth) o.visible = o.material.roughness > 0.8;   // cloth only
    });

    g.camera.position.set(base.x + 0.15, base.y + 1.30, base.z - 0.6);
    g.camera.lookAt(base.x, base.y + 0.95, base.z - 4);
    g.camera.fov = 38; g.camera.updateProjectionMatrix();
    if (g.skyDome) g.skyDome.position.copy(g.camera.position);
    g.sun.target.position.set(base.x, base.y + 1, base.z - 4);
    g.sun.position.set(base.x - 5, base.y + 9, base.z + 4);
    g.sun.target.updateMatrixWorld();
    (g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera));
  }, [faction, aiming, skin, turn]);
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  await p.screenshot({ path: `${OUT}/${name}.png` });
};

await shot('close-1-police', 'police', { aiming: false, skin: SKIN });
await shot('close-2-police-aim', 'police', { aiming: true, skin: SKIN });
await shot('close-3-gang', 'gang', { aiming: false, skin: SKIN });
console.log('done');
await b.close();
