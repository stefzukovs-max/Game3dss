/** Close-up portraits of the character rigs, for eyeballing the models. */
import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || '.';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{ width:1200, height:620 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8080/', { waitUntil:'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout:150000 });

const shot = async (name, faction, turn = 0) => {
  await p.evaluate(async ([fac, turn]) => {
    const g = window.__game;
    g.selected.faction = fac;
    g.selected.operator = fac === 'gang' ? 'boulder' : 'stone';
    window.__game.settings.intro = false;   // harnesses drive the game directly
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
    /*
     * Line them up in the middle of the plaza rather than on whichever spawn
     * the faction happened to get. The police spawn is beside the Caveirão,
     * and a camera pulled back far enough to frame five figures ends up
     * inside it — the portrait came back as the inside of a van door.
     */
    const base = new V(4, 0, 50);
    base.y = g.world.collision.groundHeight(base.x, base.z, 6, 0.5);

    const pool = GRUNTS[fac];
    pool.forEach((arch, i) => {
      const spot = new V(base.x + (i - 2) * 1.5, base.y, base.z - 5);
      spot.y = g.world.collision.groundHeight(spot.x, spot.z, base.y + 3, 0.5);
      const a = new Agent(g, arch, fac, spot);
      a.yaw = Math.PI;
      // the model faces +Z at rotation 0 and the camera sits on the +Z side,
      // so 0 is front-on and PI is from behind
      a.model.root.rotation.y = turn;
      a.model.update(0.5, { speed: 0, aiming: i % 2 === 1, crouching: false, pitch: 0, dead: false });
      g.agents.push(a);
    });
    // and the player operator beside them
    g.player.pos.set(base.x + 4.6, base.y, base.z - 5);
    g.player.model.setPosition(g.player.pos.x, g.player.pos.y, g.player.pos.z);
    g.player.model.root.rotation.y = turn;
    g.player.model.update(0.5, { speed: 0, aiming: true, crouching: false, pitch: 0, dead: false });

    /*
     * Frame from the bounds, not from an offset.
     *
     * These numbers used to be hand-tuned metres — camera here, look there —
     * which worked exactly as long as the characters stayed the size they
     * were when the numbers were written. Restyling the build to four heads
     * tall doubled the head and put the camera inside it, and the police
     * portrait came back as a black rectangle. Fitting the row's real
     * bounding box costs three lines and cannot go stale.
     */
    const THREE = await import('three');
    /*
     * By world position, not by bounding box.
     *
     * expandByObject on a SkinnedMesh reads geometry.boundingBox, which is in
     * bind space and on this pack is neither where nor how big the posed
     * character is — the first attempt came back with a box that put the
     * camera in the clouds and rendered a photograph of the sky. The figures
     * stand where their roots stand and are a known height, so use that.
     */
    const roots = [...g.agents.map((a) => a.model.root), g.player.model.root];
    const row = new THREE.Box3();
    const at = new THREE.Vector3();
    for (const r of roots) {
      r.getWorldPosition(at);
      row.expandByPoint(at.clone().add(new THREE.Vector3(-0.6, 0, -0.6)));
      row.expandByPoint(at.clone().add(new THREE.Vector3(0.6, 2.0, 0.6)));
    }
    const size = row.getSize(new THREE.Vector3());
    const mid = row.getCenter(new THREE.Vector3());
    g.camera.fov = 42; g.camera.updateProjectionMatrix();
    const aspect = g.camera.aspect;
    const vFov = (g.camera.fov * Math.PI) / 180;
    // whichever of width and height needs the most room decides the distance
    const dist = Math.max(
      (size.y / 2) / Math.tan(vFov / 2),
      (size.x / 2) / Math.tan(Math.atan(Math.tan(vFov / 2) * aspect))) * 1.16;
    g.camera.position.set(mid.x, mid.y + size.y * 0.12, row.max.z + dist);
    g.camera.lookAt(mid.x, mid.y, mid.z);
    if (g.skyDome) g.skyDome.position.copy(g.camera.position);
    g.sun.target.position.set(base.x, base.y, base.z - 5);
    g.sun.position.set(base.x - 8, base.y + 14, base.z + 8);
    g.sun.target.updateMatrixWorld();
    (g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera));
  }, [faction, turn]);
  await p.waitForTimeout(700);
  await p.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  // the supplied bodies are 20-28k triangles each, and five of them under
  // swiftshader take well past the default half-second budget to compose
  await p.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 });
};

await shot('chars-1-gang', 'gang');
await shot('chars-2-police', 'police');
// and the same line-ups from behind: the reflective band, the pack and the
// back of the vest are half of what tells the two sides apart in a firefight
await shot('chars-3-gang-back', 'gang', Math.PI);
await shot('chars-4-police-back', 'police', Math.PI);
console.log('done');
await b.close();
