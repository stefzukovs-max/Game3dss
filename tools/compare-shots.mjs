/**
 * Fixed-camera captures for before/after visual comparison.
 *   SHOT_DIR=... LABEL=before node tools/compare-shots.mjs
 * Cameras and time-of-day are identical between runs so the only variable is
 * the renderer.
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const LABEL = process.env.LABEL || 'shot';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:8080/', { waitUntil: 'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

// deterministic scene: start a run, freeze it, hide all UI
await p.evaluate(() => {
  const g = window.__game;
  // force the top tier: the headless browser reports few cores and would
  // otherwise auto-select 'medium', which skips ambient occlusion entirely
  g.settings.quality = 'high';
  g._applySettings?.();
  g.selected.faction = 'gang';
  g.selected.operator = 'boulder';
  window.__game.settings.intro = false;   // harnesses drive the game directly
  g.startRun();
  for (let i = 0; i < 60 * 20; i++) { g._tick(1 / 60); if (g.state === 'draft') g._closeDraft(); }
  g.state = 'paused';
  g.hud.show(false);
  document.getElementById('overlay').classList.add('gone');
});

const VIEWS = [
  ['a-stairs',  [1, 12, 26],   [0, 8, -10]],
  ['b-plaza',   [-2, 9, 62],   [-4, 3, 30]],
  ['c-alley',   [-40, 9, 4],   [-30, 6, -12]],
  ['d-summit',  [22, 22, -30], [0, 17, -56]],
  ['e-tower',   [-16, 14, -18],[-2, 13, -30]],
  // Eye level in a lane — the only views that show whether the set dressing
  // sits on the ground properly and reads at the scale a player sees it.
  // `eye` means "1.65 m above whatever the ground turns out to be here", so
  // these stay valid when the terraces move.
  ['f-lane',    [4, 'eye', 34],   [2, 'eye', 10]],
  ['g-doorway', [-34, 'eye', 20], [-26, 'eye', 6]],
];

for (const [name, pos, look] of VIEWS) {
  await p.evaluate(([q, l]) => {
    const g = window.__game;
    const eye = (a) => {
      if (a[1] !== 'eye') return a;
      const y = g.world.collision.groundHeight(a[0], a[2], 60, 0.4);
      return [a[0], (y > -5.9 ? y : 0) + 1.65, a[2]];
    };
    q = eye(q); l = eye(l);
    g.camera.position.set(q[0], q[1], q[2]);
    g.camera.lookAt(l[0], l[1], l[2]);
    g.camera.fov = 60;
    g.camera.updateProjectionMatrix();
    // Re-anchor the shadow frustum on whatever we are looking at, without
    // changing the sun's *direction* — read it back off the light itself
    // rather than off the procedural preset, so this stays correct once the
    // direction is coming from the HDRI instead.
    const dir = g.sun.position.clone().sub(g.sun.target.position).normalize();
    g.sun.target.position.set(l[0], l[1], l[2]);
    g.sun.position.set(l[0], l[1], l[2]).addScaledVector(dir, 90);
    g.sun.target.updateMatrixWorld();
    if (g.world?.sky) g.world.sky.position.copy(g.camera.position);
    if (g.skyDome) g.skyDome.position.copy(g.camera.position);
    (g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera));
  }, [pos, look]);
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const g = window.__game;
    (g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera));
  });
  await p.screenshot({ path: `${OUT}/${name}-${LABEL}.png` });
}
console.log('captured', LABEL);
await b.close();
