#!/usr/bin/env node
/**
 * Prints what is actually inside the baked prop GLBs: the parts a scene can
 * instantiate, their triangle counts, and their real-world size in metres.
 *
 * Placement code in src/world/props.js needs all three. Poly Haven's "modular"
 * assets are component libraries, not single props — the electricity-pole file
 * is sixty loose parts (poles, insulators, transformers, bolts) plus a handful
 * of `preset_*` groups that are the pre-assembled versions. Placement wants the
 * presets; without this listing you would be bolting poles together by hand.
 *
 * This runs the files through three's own GLTFLoader in a real browser rather
 * than reading the glTF in Node. That is not ceremony: the props are vertex
 * quantized, so the authored size only falls out once the loader has applied
 * the dequantization, and measuring it any other way reports coordinates in
 * the tens of thousands. The numbers here are by construction the same ones
 * the game will see.
 *
 *   npm start &                                # the tool needs the dev server
 *   node tools/prop-info.mjs                   # everything, presets only
 *   node tools/prop-info.mjs --all             # include loose parts
 *   node tools/prop-info.mjs modular_pipes
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const HOST = process.env.HOST || 'http://localhost:8080';

let ids = argv.filter((a) => !a.startsWith('--'));
if (!ids.length) {
  ids = (await fs.readdir(path.join(ROOT, 'assets', 'props')))
    .filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

// A bare page carrying only the importmap: loading the game itself would build
// the whole level first, which this does not need.
await page.route('**/probe.html', (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><script type="importmap">{"imports":{
    "three":"/vendor/three.module.min.js","three/addons/":"/vendor/addons/"}}</script>`,
}));
await page.goto(`${HOST}/probe.html`, { waitUntil: 'load' });

const report = await page.evaluate(async (list) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const out = [];

  for (const id of list) {
    const gltf = await loader.loadAsync(`/assets/props/${id}.glb`);
    gltf.scene.updateMatrixWorld(true);

    const parts = [];
    for (const child of gltf.scene.children) {
      let tris = 0;
      child.traverse((o) => {
        const g = o.geometry;
        if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      if (!tris) continue;
      const box = new THREE.Box3().setFromObject(child);
      const size = box.getSize(new THREE.Vector3());
      parts.push({
        name: child.name || '(unnamed)', tris,
        size: [size.x, size.y, size.z], base: box.min.y,
      });
    }
    out.push({ id, parts });
  }
  return out;
}, ids);

let grand = 0;
for (const { id, parts } of report) {
  const bytes = (await fs.stat(path.join(ROOT, 'assets', 'props', `${id}.glb`))).size;
  const total = parts.reduce((a, p) => a + p.tris, 0);
  grand += total;

  const presets = parts.filter((p) => /^preset/i.test(p.name));
  const show = (ALL || !presets.length) ? parts : presets;

  console.log(`\n=== ${id} ===  ${parts.length} parts · ${Math.round(total).toLocaleString()} tris · ${(bytes / 1e6).toFixed(2)} MB` +
    (presets.length && !ALL ? `  (${presets.length} presets shown, --all for the rest)` : ''));
  for (const p of show.sort((a, b) => b.tris - a.tris)) {
    console.log(`  ${p.name.padEnd(42)}${String(Math.round(p.tris)).padStart(7)} tris   ` +
      `${p.size.map((v) => v.toFixed(2)).join(' × ')} m   base y=${p.base.toFixed(2)}`);
  }
}
console.log(`\n${report.length} props · ${Math.round(grand).toLocaleString()} triangles total`);

await browser.close();
