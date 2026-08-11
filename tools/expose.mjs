/**
 * Two-axis lighting sweep.
 *
 * Swapping the analytic sky for a photographed one changes the absolute light
 * level by more than an order of magnitude, so every number that was tuned
 * against the old sky — exposure, sun intensity, environment weight, bloom
 * threshold — is wrong afterwards, and they interact. Guessing at coupled
 * values one screenshot at a time is slow and tends to land somewhere merely
 * tolerable. Render the grid and pick by eye.
 *
 *   node tools/expose.mjs                                  # exposure × sun
 *   X=env:0.2,0.35,0.5,0.85 Y=exposure:0.45 node tools/expose.mjs
 *   X=bloom:0,0.2,0.4 Y=env:0.3,0.5 VIEW=c-alley node tools/expose.mjs
 *
 * Knobs: exposure, sun, env, fill, bloom, bloomThreshold, ao
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const VIEW = process.env.VIEW || 'a-stairs';
const axis = (spec, dflt) => {
  const [name, vals] = (spec || dflt).split(':');
  return { name, values: vals.split(',').map(Number) };
};
const X = axis(process.env.X, 'exposure:0.35,0.45,0.55,0.7');
const Y = axis(process.env.Y, 'sun:1.2,2,3');

const VIEWS = {
  'a-stairs': [[1, 12, 26], [0, 8, -10]],
  'b-plaza': [[-2, 9, 62], [-4, 3, 30]],
  'c-alley': [[-40, 9, 4], [-30, 6, -12]],
  'd-summit': [[22, 22, -30], [0, 17, -56]],
};

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:8080/', { waitUntil: 'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

await p.evaluate(([pos, look]) => {
  const g = window.__game;
  g.settings.quality = 'high';
  g._applySettings?.();
  g.state = 'paused';
  g.hud.show(false);
  document.getElementById('overlay').classList.add('gone');
  g.camera.position.set(...pos);
  g.camera.lookAt(...look);
  g.camera.fov = 60;
  g.camera.updateProjectionMatrix();
  const dir = g.sun.position.clone().sub(g.sun.target.position).normalize();
  g.sun.target.position.set(...look);
  g.sun.position.set(...look).addScaledVector(dir, 90);
  g.sun.target.updateMatrixWorld();

  // one place that knows how to set every knob, so the sweep axes are just names
  window.__set = (knob, v) => {
    const gg = window.__game;
    switch (knob) {
      case 'exposure': gg.renderer.toneMappingExposure = v; break;
      case 'sun': gg.sun.intensity = v; break;
      case 'env': gg.scene.environmentIntensity = v; break;
      case 'fill': gg.fill.intensity = v; break;
      case 'bloom': if (gg.post?.passes.bloom) gg.post.passes.bloom.strength = v; break;
      case 'bloomThreshold': if (gg.post?.passes.bloom) gg.post.passes.bloom.threshold = v; break;
      case 'ao': if (gg.post?.passes.gtao) gg.post.passes.gtao.blendIntensity = v; break;
      default: throw new Error('unknown knob ' + knob);
    }
  };
}, VIEWS[VIEW]);

for (const yv of Y.values) {
  for (const xv of X.values) {
    await p.evaluate(([xn, xvv, yn, yvv]) => {
      window.__set(yn, yvv);
      window.__set(xn, xvv);
    }, [X.name, xv, Y.name, yv]);
    // render twice: the first pass after a pass-parameter change recompiles
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => {
        const g = window.__game;
        g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera);
      });
      await p.waitForTimeout(250);
    }
    const name = `sweep-${Y.name}${yv}-${X.name}${xv}`;
    await p.screenshot({ path: `${OUT}/${name}.png` });
    console.log(name);
  }
}
await b.close();
