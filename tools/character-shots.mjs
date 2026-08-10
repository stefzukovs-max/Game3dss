/** Close-up portraits of the character rigs, for eyeballing the models. */
import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || '.';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{ width:1200, height:620 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8080/', { waitUntil:'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout:150000 });

const shot = async (name, faction) => {
  await p.evaluate(async (fac) => {
    const g = window.__game;
    g.selected.faction = fac;
    g.selected.operator = fac === 'gang' ? 'boulder' : 'stone';
    g.startRun();
    g._tick(1/60);
    g.state = 'paused';
    document.getElementById('overlay').classList.add('gone');
    g.hud.show(false);

    // clear the field, then line up one of each archetype on flat ground
    for (const a of g.agents) a.dispose();
    g.agents.length = 0;

    const { Agent } = await import('/src/entities/ai.js');
    const { GRUNTS } = await import('/src/entities/roster.js');
    const V = g.player.pos.constructor;
    const base = g.player.pos.clone();
    base.y = g.world.collision.groundHeight(base.x, base.z, base.y + 3, 0.5);

    const pool = GRUNTS[fac];
    pool.forEach((arch, i) => {
      const spot = new V(base.x + (i - 2) * 1.5, base.y, base.z - 5);
      spot.y = g.world.collision.groundHeight(spot.x, spot.z, base.y + 3, 0.5);
      const a = new Agent(g, arch, fac, spot);
      a.yaw = Math.PI;                       // face the camera
      a.model.root.rotation.y = 0;
      a.model.update(0.5, { speed: 0, aiming: i % 2 === 1, crouching: false, pitch: 0, dead: false });
      g.agents.push(a);
    });
    // and the player operator beside them
    g.player.pos.set(base.x + 4.6, base.y, base.z - 5);
    g.player.model.setPosition(g.player.pos.x, g.player.pos.y, g.player.pos.z);
    g.player.model.root.rotation.y = 0;
    g.player.model.update(0.5, { speed: 0, aiming: true, crouching: false, pitch: 0, dead: false });

    g.camera.position.set(base.x + 0.6, base.y + 1.35, base.z + 0.4);
    g.camera.lookAt(base.x + 0.6, base.y + 1.0, base.z - 5);
    g.camera.fov = 42; g.camera.updateProjectionMatrix();
    g.world.sky.position.copy(g.camera.position);
    g.sun.target.position.set(base.x, base.y, base.z - 5);
    g.sun.position.set(base.x - 8, base.y + 14, base.z + 8);
    g.sun.target.updateMatrixWorld();
    g.renderer.render(g.scene, g.camera);
  }, faction);
  await p.waitForTimeout(700);
  await p.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  await p.screenshot({ path: `${OUT}/${name}.png` });
};

await shot('chars-1-gang', 'gang');
await shot('chars-2-police', 'police');
console.log('done');
await b.close();
