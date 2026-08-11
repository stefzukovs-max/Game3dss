/**
 * Converts OBJ/MTL model sets to glTF binaries.
 *
 * Quaternius ships the gun and vehicle packs as OBJ, FBX and .blend. There is
 * no Blender here and no Node-side OBJ→glTF converter worth trusting, but
 * three.js can already read OBJ and write GLB — so the conversion runs through
 * three's own loaders in a headless browser. That has a property worth having:
 * whatever the browser can load here is exactly what the game will load later,
 * so a model that survives conversion cannot then fail at runtime.
 *
 *   node tools/obj-to-glb.mjs <srcDir> <outDir> [nameFilter]
 *
 * Expects the dev server to be running, and serves the source directory to the
 * page through a route interception rather than copying it into the web root.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [srcDir, outDir, filter] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('usage: node tools/obj-to-glb.mjs <srcDir> <outDir> [nameFilter]');
  process.exit(1);
}
const HOST = process.env.HOST || 'http://localhost:8080';

const names = (await fs.readdir(srcDir))
  .filter((f) => f.toLowerCase().endsWith('.obj'))
  .filter((f) => !filter || f.toLowerCase().includes(filter.toLowerCase()))
  .sort();
if (!names.length) { console.error('no .obj files in ' + srcDir); process.exit(1); }
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

// serve the source folder under a virtual path, so nothing has to be copied
await page.route('**/__src/**', async (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/__src/')[1]);
  try {
    const body = await fs.readFile(path.join(srcDir, rel));
    const type = rel.endsWith('.png') ? 'image/png'
      : rel.endsWith('.jpg') ? 'image/jpeg' : 'text/plain';
    route.fulfill({ body, contentType: type });
  } catch { route.fulfill({ status: 404, body: 'no' }); }
});
await page.route('**/probe.html', (r) => r.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><script type="importmap">{"imports":{
    "three":"/vendor/three.module.min.js","three/addons/":"/vendor/addons/"}}</script>`,
}));
await page.goto(`${HOST}/probe.html`, { waitUntil: 'load' });

let done = 0;
for (const objName of names) {
  const base = objName.replace(/\.obj$/i, '');
  const mtlName = `${base}.mtl`;
  const hasMtl = await fs.access(path.join(srcDir, mtlName)).then(() => true, () => false);

  const b64 = await page.evaluate(async ([obj, mtl]) => {
    const THREE = await import('three');
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

    const loader = new OBJLoader();
    if (mtl) {
      const mats = await new MTLLoader().setPath('/__src/').loadAsync(mtl);
      mats.preload();
      loader.setMaterials(mats);
    }
    const root = await loader.setPath('/__src/').loadAsync(obj);

    /*
     * OBJ carries no PBR information, only the old Phong-ish MTL fields, so
     * three gives every surface a MeshPhongMaterial. Converting to standard
     * here — rather than at runtime — keeps the game's material handling
     * uniform and lets the exported glTF describe itself honestly.
     */
    root.traverse((o) => {
      if (!o.isMesh) return;
      const src = Array.isArray(o.material) ? o.material : [o.material];
      const out = src.map((m) => new THREE.MeshStandardMaterial({
        name: m.name || 'mat',
        color: m.color ? m.color.clone() : new THREE.Color(0xcccccc),
        map: m.map || null,
        roughness: 0.62,
        metalness: 0.0,
        side: THREE.FrontSide,
      }));
      o.material = Array.isArray(o.material) ? out : out[0];
      if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    });

    const glb = await new Promise((res, rej) => {
      new GLTFExporter().parse(root, res, rej, { binary: true });
    });
    let s = '';
    const bytes = new Uint8Array(glb);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }, [objName, hasMtl ? mtlName : null]);

  const out = path.join(outDir, `${base}.glb`);
  await fs.writeFile(out, Buffer.from(b64, 'base64'));
  done++;
  process.stdout.write(`\r  converted ${done}/${names.length}  ${base}`.padEnd(70));
}
console.log(`\n${done} models → ${outDir}`);
await browser.close();
