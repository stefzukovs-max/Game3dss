#!/usr/bin/env node
/**
 * FBX → glTF, through three's own loader.
 *
 *   node tools/fbx-to-glb.mjs <in.fbx> <out.glb> [textureDir]
 *
 * Same reasoning as `obj-to-glb.mjs`: the conversion runs in a headless browser
 * against the exact loader the game will use, so whatever comes out is by
 * definition something the game can read. A conversion done by some other
 * toolchain can be valid FBX, valid glTF, and still land in three with its
 * materials or its scale wrong.
 *
 * FBX materials are Phong; three's own FBXLoader already builds
 * MeshPhongMaterial from them, and this converts those to MeshStandardMaterial
 * so the car lights the same way as everything else in the scene.
 *
 * Textures are matched by filename against `textureDir`, because an FBX
 * references its maps by whatever absolute path they had on the machine that
 * exported it — here, someone else's Windows drive.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const [, , IN, OUT, TEXDIR] = process.argv;
if (!IN || !OUT) {
  console.error('usage: fbx-to-glb.mjs <in.fbx> <out.glb> [textureDir]');
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.fbx': 'application/octet-stream', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.tga': 'image/x-tga', '.webp': 'image/webp', '.html': 'text/html',
};

/* Serve the repo plus the FBX and its textures under one origin, so the loader
 * can resolve everything with plain relative URLs. */
const serve = (file) => new Promise((resolve) => {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let disk;
    if (url === '/model.fbx') disk = path.resolve(file);
    else if (url.startsWith('/tex/') && TEXDIR) disk = path.join(path.resolve(TEXDIR), url.slice(5));
    else disk = path.join(ROOT, url);
    try {
      const body = await fs.readFile(disk);
      res.writeHead(200, { 'content-type': MIME[path.extname(disk).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('no'); }
  });
  server.listen(0, () => resolve(server));
});

const server = await serve(IN);
const port = server.address().port;

/* the texture files we can offer, by lowercased basename */
const textures = TEXDIR
  ? (await fs.readdir(path.resolve(TEXDIR))).filter((f) => /\.(png|jpe?g|webp|tga)$/i.test(f))
  : [];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  browser:', m.text().slice(0, 160)); });
page.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'domcontentloaded' });

const b64 = await page.evaluate(async (textures) => {
  const THREE = await import('/vendor/three.module.min.js');
  const { FBXLoader } = await import('/vendor/addons/loaders/FBXLoader.js');
  const { GLTFExporter } = await import('/vendor/addons/exporters/GLTFExporter.js');

  const root = await new FBXLoader().loadAsync('/model.fbx');

  /*
   * Rehome the textures. The FBX names them by the exporting machine's own
   * absolute paths, so the loader's own attempts 404; matching on basename
   * against the folder we were handed is what actually finds them.
   */
  const byName = new Map(textures.map((f) => [f.toLowerCase(), f]));

  /**
   * Which file in the texture folder a material wants.
   *
   * An FBX names its maps by whatever absolute path they had on the machine
   * that exported it, so the loader's own attempts resolve to nothing. Matching
   * on basename against the folder we were handed is what actually finds them —
   * with a loose fallback, because an exporter will happily write "body.png"
   * for a file the artist called "Crown_Vic_Body_Color.png".
   */
  const stemsOf = (name) => String(name || '').split(/[\\/]/).pop().toLowerCase()
    .replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);

  /**
   * Every map a material should get, classified by the suffix of the filename.
   *
   * The FBX only ever wires up a diffuse slot, and it wires it to a path from
   * the exporting artist's own drive that 404s here — so the material arrives
   * carrying a texture object with no image behind it, which looks exactly like
   * a texture that worked. The material's *name* and its dead map's *filename*
   * are the two clues to what it wanted; the folder is then searched for every
   * map belonging to that part, not just the colour.
   */
  const SLOTS = [
    [/color|diffuse|albedo|basecolor/, 'map'],
    [/rough/, 'roughnessMap'],
    [/metal/, 'metalnessMap'],
    [/normal/, 'normalMap'],
    [/bump/, 'bumpMap'],
    [/emmision|emission|emissive/, 'emissiveMap'],
    [/opacity|alpha/, 'alphaMap'],
  ];
  const mapsFor = (matName, mapPath) => {
    const words = [...new Set([...stemsOf(mapPath), ...stemsOf(matName)])]
      .filter((w) => !['crown', 'vic', 'ford', 'png', 'jpg'].includes(w));
    if (!words.length) return {};
    const mine = textures.filter((f) => {
      const low = f.toLowerCase();
      return words.some((w) => low.includes(w));
    });
    const out = {};
    for (const f of mine) {
      const low = f.toLowerCase();
      const slot = SLOTS.find(([re]) => re.test(low))?.[1];
      if (slot && !out[slot]) out[slot] = f;
    }
    return out;
  };

  const report = { meshes: 0, tris: 0, materials: [], missing: [], hooked: 0 };
  const jobs = new Map();
  const mats = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    report.meshes++;
    const g = o.geometry;
    report.tris += (g.index?.count ?? g.attributes.position.count) / 3;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    src.forEach((m, i) => {
      // a map that 404'd is still an object; only one with pixels counts
      const live = !!(m.map?.image && (m.map.image.width || m.map.image.naturalWidth));
      const path = m.map?.image?.src ?? m.map?.source?.data?.src ?? null;
      const want = live ? {} : mapsFor(m.name, path);
      for (const f of Object.values(want)) if (!jobs.has(f)) jobs.set(f, null);
      mats.push({ mesh: o, index: i, isArray: Array.isArray(o.material), m, want, live });
    });
  });

  const loader = new THREE.TextureLoader();
  await Promise.all([...jobs.keys()].map(async (file) => {
    try {
      const t = await loader.loadAsync('/tex/' + encodeURIComponent(file));
      t.flipY = false;                                  // glTF convention
      jobs.set(file, t);
    } catch { jobs.set(file, null); }
  }));

  for (const entry of mats) {
    const { m, want, live } = entry;
    const std = new THREE.MeshStandardMaterial({
      name: m.name || 'mat',
      color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
      roughness: 0.6, metalness: 0.0, side: m.side,
      transparent: !!m.transparent, opacity: m.opacity ?? 1,
    });
    let got = 0;
    if (live) { std.map = m.map; std.map.colorSpace = THREE.SRGBColorSpace; got++; }
    for (const [slot, file] of Object.entries(want)) {
      const t = jobs.get(file);
      if (!t?.image?.width) continue;
      // only the base colour is sRGB; the rest are data and must stay linear
      if (slot === 'map' || slot === 'emissiveMap') t.colorSpace = THREE.SRGBColorSpace;
      std[slot] = t;
      got++;
    }
    if (std.emissiveMap) std.emissive = new THREE.Color(0xffffff);
    if (std.metalnessMap) std.metalness = 1;
    if (std.roughnessMap) std.roughness = 1;
    if (got) report.hooked++; else if (m.name) report.missing.push(m.name);
    report.materials.push(std.name);
    if (entry.isArray) entry.mesh.material[entry.index] = std;
    else entry.mesh.material = std;
  }
  report.files = [...jobs.entries()].map(([f, t]) => `${f}${t ? '' : ' (FAILED)'}`);

  const glb = await new Promise((res, rej) => {
    new GLTFExporter().parse(root, res, rej, { binary: true });
  });
  let s = '';
  const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return { b64: btoa(s), report };
}, textures);

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, Buffer.from(b64.b64, 'base64'));
const r = b64.report;
console.log(`  ${path.basename(OUT)}  ${r.meshes} meshes  ${Math.round(r.tris)} tris  ` +
  `${new Set(r.materials).size} materials  ${(await fs.stat(OUT)).size / 1e6} MB`);
console.log(`  textures hooked up: ${r.hooked}`);
if (r.files?.length) console.log(`  files used: ${r.files.join(', ')}`);
if (r.missing.length) console.log(`  no texture matched for: ${[...new Set(r.missing)].join(', ')}`);

await browser.close();
server.close();
