/**
 * Kit probe.
 *
 *     npm run kit -- [prefix]        # default: city
 *     npm run kit -- slums --parts   # every mesh inside the file, separately
 *
 * Prints a model's bounding box and triangle count, measured through three's
 * own loader for the same reason `prop-info.mjs` is: the file is quantized, so
 * reading the accessors in Node reports tens of thousands of units.
 *
 * Two modes, because the supplied kits arrive two ways. Quaternius ships one
 * file per module, so the default lists the models. The slums kit is one file
 * holding all 36 pieces, so `--parts` descends into it and measures each mesh
 * in the file's own frame — which is the only way to find out what the grid is,
 * and whether the pieces share an origin or each sit where the artist left them.
 * Guessing that from the pack's screenshots is how you end up with a facade
 * three centimetres proud of its wall.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const PARTS = args.includes('--parts');
const PREFIX = args.find((a) => !a.startsWith('--')) ?? 'city';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

const out = await page.evaluate(async ({ PREFIX, PARTS }) => {
  const THREE = await import('three');
  const g = window.__game;
  const rows = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const mid = new THREE.Vector3();

  const measure = (obj) => {
    obj.updateWorldMatrix(true, true);
    box.setFromObject(obj);
    box.getSize(size);
    box.getCenter(mid);
    let tris = 0;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
    return { x: size.x, y: size.y, z: size.z, y0: box.min.y, cx: mid.x, cz: mid.z, tris };
  };

  for (const [key, node] of g.assets.models) {
    if (!key.startsWith(PREFIX + ':')) continue;
    if (!PARTS) { rows.push([key.slice(PREFIX.length + 1), measure(node)]); continue; }
    // the file's own frame, not the placed one: reset the root before descending
    const probe = node.clone(true);
    probe.position.set(0, 0, 0);
    probe.rotation.set(0, 0, 0);
    probe.scale.set(1, 1, 1);
    probe.updateWorldMatrix(true, true);
    probe.traverse((o) => { if (o.isMesh) rows.push([o.name || '(unnamed)', measure(o)]); });
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return rows.map(([n, m]) =>
    `  ${n.slice(0, 30).padEnd(30)} ${m.x.toFixed(2).padStart(6)} × ${m.y.toFixed(2).padStart(6)} × ${m.z.toFixed(2).padStart(6)} m` +
    `   base y ${m.y0.toFixed(2).padStart(7)}   centre ${m.cx.toFixed(1).padStart(6)},${m.cz.toFixed(1).padStart(6)}` +
    `   ${String(Math.round(m.tris)).padStart(5)} tris`);
}, { PREFIX, PARTS });

console.log(`${PREFIX} — ${out.length} ${PARTS ? 'meshes' : 'models'}`);
for (const l of out) console.log(l);
await browser.close();
