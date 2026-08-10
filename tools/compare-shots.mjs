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
];

for (const [name, pos, look] of VIEWS) {
  await p.evaluate(([q, l]) => {
    const g = window.__game;
    g.camera.position.set(q[0], q[1], q[2]);
    g.camera.lookAt(l[0], l[1], l[2]);
    g.camera.fov = 60;
    g.camera.updateProjectionMatrix();
    g.sun.target.position.set(l[0], l[1], l[2]);
    if (g.sky) g.sun.position.set(l[0], l[1], l[2]).addScaledVector(g.sky.preset.sunDir, 90);
    else g.sun.position.set(l[0] - 55, l[1] + 70, l[2] + 45);
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
