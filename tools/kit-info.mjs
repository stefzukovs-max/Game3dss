/**
 * Kit probe.
 *
 * Prints every city-kit module's bounding box and triangle count, measured
 * through three's own loader for the same reason `prop-info.mjs` is: the file
 * is quantized, so reading the accessors in Node reports tens of thousands.
 *
 * Modular kits are built on a grid, and the placement code has to know what the
 * grid is. Guessing it from the pack's screenshots is how you end up with a
 * facade whose windows are three centimetres proud of the wall.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

const out = await page.evaluate(async () => {
  const THREE = await import('three');
  const g = window.__game;
  const rows = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();

  for (const [key, node] of g.assets.models) {
    if (!key.startsWith('city:')) continue;
    node.updateWorldMatrix(true, true);
    box.setFromObject(node);
    box.getSize(size);
    let tris = 0;
    node.traverse((o) => {
      if (!o.isMesh) return;
      tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
    rows.push([key.slice(5), size.x, size.y, size.z, box.min.y, tris]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return rows.map(([n, x, y, z, y0, t]) =>
    `  ${n.padEnd(18)} ${x.toFixed(2).padStart(6)} × ${y.toFixed(2).padStart(6)} × ${z.toFixed(2).padStart(6)} m` +
    `   base y ${y0.toFixed(2).padStart(6)}   ${String(t).padStart(5)} tris`);
});

console.log(`city kit — ${out.length} modules`);
for (const l of out) console.log(l);
await browser.close();
