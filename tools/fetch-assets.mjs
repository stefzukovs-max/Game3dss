#!/usr/bin/env node
/**
 * Downloads every asset in tools/asset-manifest.js, bakes it down to
 * something a browser can actually stream, and writes:
 *
 *   assets/materials/<slug>/{color,normal,arm}.webp
 *   assets/props/<id>.glb
 *   assets/hdri/<id>.hdr
 *   assets/manifest.json     ← what the game reads at runtime
 *   CREDITS.md               ← generated, never hand-edited
 *
 * Run:  npm run assets          (skips anything already downloaded)
 *       npm run assets -- --force
 *       npm run assets -- --only=materials,hdri
 *
 * This is a build-time tool. Nothing in src/ imports it, and none of its
 * dependencies (sharp, gltf-transform) ship to the browser — the game loads
 * the baked output in assets/ and nothing else.
 */
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, quantize, mergeDocuments } from '@gltf-transform/functions';
import { fetchItchPack } from './itch-fetch.mjs';
import { MATERIALS, PROPS, HDRIS, MODEL_PACKS, LOCAL_MODELS, LICENSE, SOURCES } from './asset-manifest.js';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets');
const CACHE = path.join(os.tmpdir(), 'crosshill-asset-cache');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ONLY = (argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'materials,props,hdri,models').split(',');
const want = (kind) => ONLY.includes(kind);

const log = (...a) => console.log(...a);
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

/* ── networking ──────────────────────────────────────────────────────────
 * Poly Haven's CDN and ambientCG's redirect chain both drop connections
 * occasionally on a cold cache; a few hundred sequential requests will hit it
 * every time. Retry with backoff rather than making the whole run a coin flip.
 */
async function fetchRetry(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (r.ok) return r;
      last = new Error(`HTTP ${r.status} for ${url}`);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) throw last;
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw last;
}

/** Download to the on-disk cache so re-runs and --only passes are instant. */
async function cached(url, name) {
  const file = path.join(CACHE, name);
  try {
    const st = await fs.stat(file);
    if (st.size > 0) return file;
  } catch { /* not cached */ }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const r = await fetchRetry(url);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
  return file;
}

/* ── materials ───────────────────────────────────────────────────────────
 * ambientCG ships a zip of loose maps. We keep three:
 *
 *   color   — sRGB albedo
 *   normal  — the GL-convention normal (three expects +Y up; the DX one is
 *             flipped and would light every bump inside out)
 *   arm     — R=ambient occlusion, G=roughness, B=metalness, packed into one
 *             RGB image. That is the glTF convention, and three can point
 *             aoMap/roughnessMap/metalnessMap at a single texture, so three
 *             maps cost one download and one sampler instead of three.
 *
 * Displacement is dropped: nothing here is tessellated, and parallax on a
 * 140 m map costs more than it returns.
 */
async function buildMaterial(m) {
  const dir = path.join(OUT, 'materials', m.slug);
  const maps = m.maps ?? ['color', 'normal', 'arm'];
  // check every map, not just the first — a run that died partway through
  // would otherwise leave a half-built set that looks complete forever
  const done = await Promise.all(maps.map((k) => exists(path.join(dir, `${k}.webp`))));
  if (!FORCE && done.every(Boolean)) {
    log(`  · ${m.slug} (cached)`);
    return manifestEntryFor(m, maps, dir);
  }

  const zip = await cached(`https://ambientcg.com/get?file=${m.id}_1K-JPG.zip`, `acg/${m.id}.zip`);
  const tmp = path.join(CACHE, 'acg-x', m.id);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  await exec('unzip', ['-o', '-q', zip, '-d', tmp]);
  const files = await fs.readdir(tmp);
  const find = (suffix) => {
    const f = files.find((x) => x.endsWith(`_${suffix}.jpg`) || x.endsWith(`_${suffix}.png`));
    return f ? path.join(tmp, f) : null;
  };

  await fs.mkdir(dir, { recursive: true });
  const S = m.size;
  const written = [];

  if (maps.includes('color')) {
    const src = find('Color');
    if (!src) throw new Error(`${m.id}: no Color map`);
    await sharp(src).resize(S, S).webp({ quality: 84 }).toFile(path.join(dir, 'color.webp'));
    written.push('color');
  }

  if (maps.includes('normal')) {
    const src = find('NormalGL') ?? find('Normal');
    if (src) {
      // normals bake badly at low quality — a banded normal map shows up as
      // visible terracing across every flat wall, so it gets the extra bytes
      await sharp(src).resize(S, S).webp({ quality: 92 }).toFile(path.join(dir, 'normal.webp'));
      written.push('normal');
    }
  }

  if (maps.includes('arm')) {
    const ao = find('AmbientOcclusion');
    const rough = find('Roughness');
    const metal = find('Metalness');
    const flat = (v) => sharp({ create: { width: S, height: S, channels: 3, background: { r: v, g: v, b: v } } })
      .toColourspace('b-w').png().toBuffer();
    const chan = async (f, fallback) => (f
      ? sharp(f).resize(S, S).removeAlpha().toColourspace('b-w').png().toBuffer()
      : flat(fallback));
    const [r, g, b] = await Promise.all([chan(ao, 255), chan(rough, 200), chan(metal, 0)]);
    await sharp(r).joinChannel([g, b]).webp({ quality: 88 }).toFile(path.join(dir, 'arm.webp'));
    written.push('arm');
  }

  await fs.rm(tmp, { recursive: true, force: true });
  const entry = manifestEntryFor(m, written, dir);
  log(`  ✓ ${m.slug.padEnd(16)} ${String(S).padStart(4)}px  ${mb(await dirSize(dir))}`);
  return entry;
}

function manifestEntryFor(m, maps, dir) {
  return {
    slug: m.slug, source: 'ambientcg', id: m.id, size: m.size, tile: m.tile ?? 1, use: m.use,
    maps: Object.fromEntries(maps.map((k) => [k, `materials/${m.slug}/${k}.webp`])),
  };
}

/* ── props ───────────────────────────────────────────────────────────────
 * Poly Haven serves a .gltf + .bin + loose JPG textures. We pull the pieces,
 * reassemble them, then run the standard cleanup:
 *
 *   dedup/prune   drop duplicate accessors and unreferenced junk
 *   weld          merge coincident vertices (typically 20-40% off index data)
 *   textureCompress  bake to WebP at the target resolution
 *   quantize      store positions/UVs as 16-bit ints instead of floats
 *
 * Quantization is the reason these come out small without a decoder: it uses
 * KHR_mesh_quantization, which three's GLTFLoader supports natively. Draco or
 * meshopt would compress harder but each needs a WASM decoder shipped
 * alongside, and the download saving does not pay for that here.
 */
async function buildProp(p) {
  const out = path.join(OUT, 'props', `${p.id}.glb`);
  if (!FORCE && await exists(out)) {
    log(`  · ${p.id} (cached)`);
    // still ask for the credit line — skipping it on the cached path is how
    // CREDITS.md ends up crediting nobody for most of the pack
    return { id: p.id, source: 'polyhaven', file: `props/${p.id}.glb`, use: p.use,
      authors: await propAuthors(p.id) };
  }

  const files = await (await fetchRetry(`https://api.polyhaven.com/files/${p.id}`)).json();
  const lod = files.gltf?.['1k']?.gltf ?? Object.values(files.gltf ?? {})[0]?.gltf;
  if (!lod) throw new Error(`${p.id}: no glTF variant`);

  // Poly Haven's `include` map is keyed by the relative path the .gltf uses,
  // so laying them out under that key is all the resolving that is needed.
  const stage = path.join(CACHE, 'ph', p.id);
  await fs.mkdir(stage, { recursive: true });
  const main = path.join(stage, path.basename(new URL(lod.url).pathname));
  await fs.copyFile(await cached(lod.url, `ph/${p.id}/${path.basename(main)}`), main);
  for (const [rel, info] of Object.entries(lod.include ?? {})) {
    const dest = path.join(stage, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(await cached(info.url, `ph/${p.id}/${rel}`), dest);
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(main);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: false }),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [p.size, p.size], quality: 86 }),
    quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|TANGENT)/ }),
  );

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, await io.writeBinary(doc));
  const authors = await propAuthors(p.id);
  log(`  ✓ ${p.id.padEnd(30)} ${mb((await fs.stat(out)).size)}`);
  return { id: p.id, source: 'polyhaven', file: `props/${p.id}.glb`, use: p.use, authors };
}

const authorCache = new Map();
async function propAuthors(id) {
  if (authorCache.has(id)) return authorCache.get(id);
  const info = await (await fetchRetry(`https://api.polyhaven.com/info/${id}`)).json();
  const a = { name: info.name ?? id, authors: Object.keys(info.authors ?? {}) };
  authorCache.set(id, a);
  return a;
}

/* ── HDRI ────────────────────────────────────────────────────────────────
 * Kept as raw Radiance .hdr. It is only ~1.4 MB at 1k, and the alternative
 * (tone-mapped LDR) would throw away exactly the >1.0 sun values that make
 * image-based lighting worth doing in the first place.
 */
async function buildHdri(h) {
  const out = path.join(OUT, 'hdri', `${h.id}_${h.res}.hdr`);
  if (!FORCE && await exists(out)) {
    log(`  · ${h.id} (cached)`);
  } else {
    const files = await (await fetchRetry(`https://api.polyhaven.com/files/${h.id}`)).json();
    const src = files.hdri?.[h.res]?.hdr;
    if (!src) throw new Error(`${h.id}: no ${h.res} hdr`);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.copyFile(await cached(src.url, `hdri/${h.id}_${h.res}.hdr`), out);
    log(`  ✓ ${h.id.padEnd(30)} ${mb((await fs.stat(out)).size)}`);
  }
  return { id: h.id, source: 'polyhaven', file: `hdri/${h.id}_${h.res}.hdr`, use: h.use, ...await propAuthors(h.id) };
}

/* ── model packs ─────────────────────────────────────────────────────────
 * Guns and vehicles, which neither photogrammetry library carries. Quaternius
 * publishes these CC0 through itch.io in OBJ/FBX/.blend — no glTF — so the
 * pipeline unzips them, runs the OBJ sets through three's own loaders in a
 * headless browser to get GLB, then applies the same optimisation the Poly
 * Haven props get.
 *
 * Only the models named in each pack's `pick` map are kept. The gun pack alone
 * is forty weapons; shipping all of them to every player to use four would be
 * three megabytes of nothing.
 */
async function buildModelPack(pack) {
  const outDir = path.join(OUT, 'models', pack.id);
  const wanted = Object.entries(pack.pick ?? pack.files ?? {});
  // a merged kit is one file on disk, whatever the slot count
  const outputs = pack.merge ? [`${pack.merge}.glb`] : wanted.map(([slot]) => `${slot}.glb`);
  const have = await Promise.all(outputs.map((f) => exists(path.join(outDir, f))));
  if (!FORCE && have.every(Boolean)) {
    log(`  · ${pack.id} (cached)`);
    return wanted.map(([slot, src]) => ({
      pack: pack.id, slot, source: 'quaternius', model: src,
      file: `models/${pack.id}/${pack.merge ?? slot}.glb`,
      ...(pack.merge ? { part: slot } : {}),
    }));
  }

  const zip = path.join(CACHE, 'itch', `${pack.slug}.zip`);
  if (!await exists(zip)) {
    await fs.mkdir(path.dirname(zip), { recursive: true });
    const got = await fetchItchPack(pack.user, pack.slug, zip);
    log(`    downloaded ${got.name} (${mb(got.bytes)})`);
  }

  const stage = path.join(CACHE, 'itch-x', pack.id);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  await exec('unzip', ['-o', '-q', zip, '-d', stage]);

  /*
   * Two intake paths. OBJ packs go through three's own loaders in a browser to
   * become glTF; packs that already ship glTF are taken as-is, because routing
   * a rigged character through OBJ would silently drop its skeleton.
   */
  let glbDir;
  if (pack.format === 'gltf') {
    glbDir = stage;
    /*
     * Resolve the pack's own texture paths before reading anything.
     *
     * The character glTF references images by bare filename, but the archive
     * keeps them in a sibling Textures folder — and exports some of them under
     * a `_png` suffix the glTF does not use. Neither is worth "fixing" in the
     * glTF; gathering every image next to the glTF, under both spellings, makes
     * the references resolve without touching the file.
     */
    await resolvePackTextures(stage);
  } else {
    const objDir = await findDir(stage, pack.dir);
    if (!objDir) throw new Error(`${pack.id}: no ${pack.dir} folder in the archive`);
    glbDir = path.join(stage, '_glb');
    await exec(process.execPath, [
      path.join(ROOT, 'tools', 'obj-to-glb.mjs'), objDir, glbDir,
    ], { maxBuffer: 1 << 24 });
  }

  await fs.mkdir(outDir, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (pack.merge) return mergeModelPack(pack, glbDir, outDir, io, wanted);

  const entries = [];
  for (const [slot, src] of wanted) {
    const from = pack.format === 'gltf'
      ? await findFile(glbDir, src)
      : path.join(glbDir, `${src}.glb`);
    if (!from || !await exists(from)) { console.error(`  ✗ ${pack.id}/${slot}: ${src} not in pack`); continue; }
    const doc = await io.read(from);
    await doc.transform(
      dedup(), prune({ keepAttributes: false }), weld(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [pack.size, pack.size], quality: 86 }),
      // JOINTS/WEIGHTS are deliberately left out of the quantize pattern:
      // quantizing skin weights is what turns a rigged character into a
      // shredded mesh the first time a bone moves
      quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|TANGENT)/ }),
    );
    const to = path.join(outDir, `${slot}.glb`);
    await fs.writeFile(to, await io.writeBinary(doc));
    log(`  ✓ ${(pack.id + '/' + slot).padEnd(20)} ${src.padEnd(18)} ${mb((await fs.stat(to)).size)}`);
    entries.push({ pack: pack.id, slot, source: 'quaternius', model: src, file: `models/${pack.id}/${slot}.glb` });
  }
  return entries;
}

/**
 * Fold a whole modular kit into one GLB, each module a named node.
 *
 * Modular kits share their textures across every piece — this one dresses forty
 * modules from nine 2048² PBR sets — so the per-module path would write forty
 * files that each embed their own copy of the brickwork. Merging first means
 * `dedup` sees the duplicates as duplicates and collapses them, and the runtime
 * gets one request and one set of GPU uploads instead of forty.
 */
async function mergeModelPack(pack, glbDir, outDir, io, wanted) {
  const { Document } = await import('@gltf-transform/core');
  const doc = new Document();
  const scene = doc.createScene(pack.id);
  const entries = [];

  for (const [slot, src] of wanted) {
    // kit modules are named without an extension in the manifest, the way the
    // OBJ packs' picks are, so the two read the same
    let from = null;
    for (const name of [src, `${src}.gltf`, `${src}.glb`]) {
      from = await findFile(glbDir, name);
      if (from) break;
    }
    if (!from) { console.error(`  ✗ ${pack.id}/${slot}: ${src} not in pack`); continue; }

    const sub = await io.read(from);
    const before = new Set(doc.getRoot().listScenes());
    mergeDocuments(doc, sub);

    /*
     * `merge` brings the other document's scenes across intact. Re-parent each
     * new scene's roots under one named node so the runtime can ask for a
     * module by slot, then drop the now-empty scene.
     */
    const group = doc.createNode(slot);
    for (const s of doc.getRoot().listScenes()) {
      if (before.has(s)) continue;
      for (const child of s.listChildren()) { s.removeChild(child); group.addChild(child); }
      s.dispose();
    }
    scene.addChild(group);
    entries.push({ pack: pack.id, slot, source: 'quaternius', model: src,
      file: `models/${pack.id}/${pack.merge}.glb`, part: slot });
  }

  doc.getRoot().setDefaultScene(scene);
  /*
   * Each merged document arrives with its own buffer, and a GLB may only have
   * one. Point every accessor at the first and drop the rest.
   */
  const [buffer] = doc.getRoot().listBuffers();
  for (const a of doc.getRoot().listAccessors()) a.setBuffer(buffer);
  for (const b of doc.getRoot().listBuffers()) if (b !== buffer) b.dispose();

  await doc.transform(
    dedup(), prune({ keepAttributes: false }), weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [pack.size, pack.size], quality: 86 }),
    quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|TANGENT)/ }),
  );

  const to = path.join(outDir, `${pack.merge}.glb`);
  await fs.writeFile(to, await io.writeBinary(doc));
  log(`  ✓ ${(pack.id + '/' + pack.merge).padEnd(20)} ${entries.length} modules  ${mb((await fs.stat(to)).size)}`);
  return entries;
}

/** Copy every image in the pack next to each glTF, under both spellings. */
async function resolvePackTextures(root) {
  const images = [];
  const gltfs = [];
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) images.push(p);
      else if (/\.gltf$/i.test(e.name)) gltfs.push(p);
    }
  };
  await walk(root);

  for (const g of gltfs) {
    const dir = path.dirname(g);
    for (const img of images) {
      const base = path.basename(img);
      const ext = path.extname(base);
      const alias = `${base.slice(0, -ext.length)}_${ext.slice(1)}${ext}`;   // T_X.png → T_X_png.png
      for (const name of [base, alias]) {
        const dest = path.join(dir, name);
        if (!await exists(dest)) await fs.copyFile(img, dest).catch(() => {});
      }
    }
  }
}

/** Depth-first search for a file with the given name. */
async function findFile(root, name) {
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) { const hit = await findFile(p, name); if (hit) return hit; }
    else if (e.name === name) return p;
  }
  return null;
}

/** Depth-first search for a directory with the given name. */
async function findDir(root, name) {
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    if (e.name.toLowerCase() === name.toLowerCase()) return p;
    const hit = await findDir(p, name);
    if (hit) return hit;
  }
  return null;
}

/* ── credits ─────────────────────────────────────────────────────────────*/
function writeCredits(manifest) {
  const rows = (list, cols) => [
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...list,
  ].join('\n');

  const mats = manifest.materials.map((m) =>
    `| \`${m.slug}\` | [${m.id}](https://ambientcg.com/view?id=${m.id}) | ${m.size}px | ${m.use} |`);
  const props = manifest.props.map((p) =>
    `| [${p.authors?.name ?? p.id}](https://polyhaven.com/a/${p.id}) | ${(p.authors?.authors ?? []).join(', ') || '—'} | ${p.use} |`);
  /*
   * Only the Quaternius packs go in this table, and the filter is the point:
   * a supplied model has no `model` field and no pack behind it, so the old
   * unconditional map credited every model the owner sent us to the Realistic
   * Car Pack — a statue, a slum kit and a police van, all attributed to a
   * library that never shipped them. Supplied models are listed in their own
   * section further down, where their provenance can be stated honestly.
   */
  const models = (manifest.models ?? [])
    .filter((m) => m.source !== 'supplied')
    .map((m) => `| \`${m.slot}\` | ${m.model} | ` +
      `[${m.pack === 'guns' ? 'Ultimate Gun Pack' : 'Realistic Car Pack'}](https://quaternius.com) | ${m.pack} |`);
  const supplied = (manifest.models ?? [])
    .filter((m) => m.source === 'supplied')
    .map((m) => `| \`${m.pack}:${m.slot}\` | ${m.name ?? '—'} | ${m.use ?? '—'} |`);
  const hdris = manifest.hdris.map((h) =>
    `| [${h.name ?? h.id}](https://polyhaven.com/a/${h.id}) | ${(h.authors ?? []).join(', ') || '—'} | ${h.use} |`);

  return `# Credits

Every third-party asset in this repository is **${LICENSE.name}** — a public
domain dedication. CC0 permits copying, modifying and redistributing the files,
including commercially and including shipping the raw files inside a game, with
no attribution requirement.

This file exists anyway. The people below scanned, photographed and modelled
this material and gave it away; naming them costs nothing and is the right
thing to do.

Full licence text: <${LICENSE.url}>

Everything is fetched and baked by \`npm run assets\` from
\`tools/asset-manifest.js\`. Nothing here is hand-edited.

---

## Materials — ${SOURCES.ambientcg.name}

<${SOURCES.ambientcg.url}> · licence: <${SOURCES.ambientcg.license}>

ambientCG releases all assets under CC0. Each entry below is downloaded as a
1K JPG set, then baked to WebP: sRGB colour, an OpenGL-convention normal map,
and an ARM map packing ambient occlusion, roughness and metalness into the R,
G and B channels of a single image.

${rows(mats, ['In-game name', 'ambientCG asset', 'Baked size', 'Used for'])}

## 3D props — ${SOURCES.polyhaven.name}

<${SOURCES.polyhaven.url}> · licence: <${SOURCES.polyhaven.license}>

Poly Haven releases all assets under CC0 and funds the work through Patreon.
Each prop is downloaded as glTF, then welded, pruned, texture-compressed to
WebP and vertex-quantized into a single \`.glb\`.

${rows(props, ['Asset', 'Author(s)', 'Used for'])}

## Weapons and vehicles — ${SOURCES.quaternius.name}

<${SOURCES.quaternius.url}> · licence: CC0 1.0, stated in each pack's
\`License.txt\`

Quaternius hand-models and releases large game-asset packs under CC0. These are
the only two things neither photogrammetry library carries — firearms and
vehicles — and a third-person shooter needs both on screen constantly.

The packs ship as OBJ, FBX and .blend with no glTF, and are distributed through
itch.io, which has no plain file URLs. \`tools/itch-fetch.mjs\` performs the
download handshake and \`tools/obj-to-glb.mjs\` converts the OBJ sets by running
them through three.js's own loaders in a headless browser, so \`npm run assets\`
still reproduces everything from a clean clone.

${rows(models, ['In-game slot', 'Model', 'Pack', 'Kind'])}

## Environment lighting — ${SOURCES.polyhaven.name}

${rows(hdris, ['HDRI', 'Author(s)', 'Used for'])}

---

## Deliberately excluded

Three sources of "free" characters were found, evaluated and left out. Two of
them fail on licensing, because "free to download" and "free to redistribute"
are not the same thing and this repository redistributes everything it ships;
the third is clean but wrong for the job.

**Mixamo characters — including three.js's own \`Soldier.glb\`.** Mixamo is the
obvious source for rigged, animated, roughly-realistic humans, and
\`examples/models/gltf/Soldier.glb\` in the three.js repository is a Mixamo
export. Adobe's terms license Mixamo content for *use* in a project; they are
not a clear grant to redistribute the raw model files in a public repository,
and downloading from Mixamo requires an Adobe account, so the files cannot be
fetched reproducibly by \`npm run assets\` either. Ambiguous redistribution
rights, so: excluded.

**Renderpeople / Human Alloy free samples.** Photoscanned, genuinely
photorealistic, free to download — and the licence explicitly forbids
redistribution. Unambiguous, so: excluded.

### The characters

The characters are real rigged humans driven by skeletal animation. Two CC0
packs from Quaternius make it work, and neither is any use on its own:

| Pack | What it gives |
|---|---|
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | An anatomically proportioned rigged human — 12.5k triangles, real hands, separate hair and eye meshes |
| [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | 43 named clips on the same skeleton |

The clips are the ones a third-person shooter actually needs: \`Idle_Loop\`,
\`Walk_Loop\`, \`Jog_Fwd_Loop\`, \`Sprint_Loop\`, \`Crouch_Idle_Loop\`,
\`Crouch_Fwd_Loop\`, \`Pistol_Aim_Down\` / \`_Neutral\` / \`_Up\`,
\`Pistol_Shoot\`, \`Pistol_Reload\`, \`Hit_Chest\`, \`Hit_Head\`,
\`Death01\`, \`Jump_Start\` / \`_Loop\` / \`_Land\`, \`Roll\`.

**The risk was retargeting**, and it was measured rather than assumed: the two
packs share all 65 bones, and every track of a clip binds to the base
character's skeleton with no renaming. The animation library drives the body
directly.

**The physique needed changing first.** The pack's body is called "Superhero"
and is built like one, and since the clothing is cut from that surface it
inherits every bulge — dressed, it read as a bodybuilder in body paint.
\`reshapeBody\` contracts the mesh around each bone, perpendicular to that
bone's own run, and blends the result by skin weight the way skinning does.
Every centre is a point *on* its bone, so the bone stays the axis of its limb
and the skeleton does not have to move with the skin.

**The gap was clothing.** The base pack ships bare bodies, and no CC0 outfit
set anywhere shares this skeleton — the only modular outfit pack built for it
is fantasy armour. So the clothing is cut out of the body itself, in
\`src/entities/outfit.js\`: a garment is the region of the body it covers,
copied and pushed a centimetre or two along its own normals, so it inherits the
pack's skin weights and deforms correctly with no rigging step. Bone weights
give the soft boundaries — an armhole follows the shoulder — and cut planes give
the hard ones.

A shell offset along the body's normals is a perfect cast of it, so a garment
left there shows the abdominals through the shirt and the trousers read as
leggings. Each one is relaxed against its own neighbours a few times to lift it
off the muscle relief, and the clearance that smoothing eats is pushed back out
afterwards.

Anything that would not deform is modelled and hung off a bone instead:
helmets, visors, night vision, caps, magazine pouches, shoulder radios,
drop-leg holsters, knee pads, the gold chain — and footwear, because a shell
around a foot is a shrink-wrapped foot, with toes and no sole. The pack's
hairstyles go on the head bone the same way.

\`npm run check:outfits\` reports what every preset cut, so a garment that
comes back empty shows up as a number rather than as an absence in a
screenshot, and \`npm run rig\` prints the measurements the cuts are written
against.

### The map

The hillside is procedural, on scanned materials. What the
[Downtown City MegaKit](https://quaternius.itch.io/downtown-city-megakit)
adds is the fittings: modelled doors hung in the openings the houses punch,
metal handrails down the staircases, and bollards, drains, manholes and
planters along the lower street.

It is curated against the setting rather than against the pack. Exposed brick
and roll-up shopfronts are what a hillside like this is built from; the slate
roofs, stone cornices and ornamental trim are a north-Atlantic downtown and
would look imported, so they are left in the archive along with the pack's
three pre-built buildings.

The kit is merged into one glTF at build time. Every module references the same
handful of 2048² PBR sets, so one file per module would embed forty copies of
the brickwork; merged first, dedup collapses them and the whole kit costs
2.5 MB. \`npm run kit\` prints every module's grid size.

### Supplied assets

These models did not come from the CC0 libraries above. They were supplied by
the project owner, and their provenance and licence are theirs to state, not
ours — the pipeline only records them, and \`npm run assets\` cannot rebuild them
from a clean clone.

${rows(supplied, ['Slot', 'Model', 'Used for'])}

Two of them are worth a second look before this is published anywhere
commercial. \`police:interceptor\` is a real-world vehicle carrying a
manufacturer's trademarked design and badging, and \`landmark:christ\` is a
copyrighted sculpture whose rights are actively enforced. Model licences,
trademark and the copyright in a depicted work are three separate questions,
and a licence to use a mesh answers only the first of them.

It arrived as a \`.blend\` and an \`.fbx\`. The FBX is the one that looks
convenient and it is unusable — three's FBX importer mangles this file's
pivots, and the car loads as a heap of detached panels. The \`.blend\` exports
cleanly through Blender, which is the path \`tools/fbx-to-glb.mjs\` and
\`tools/bake-glb.mjs\` document.

**Still excluded** for licensing, unchanged: Mixamo (no clear redistribution
grant, and an account is required) and Renderpeople / Human Alloy free samples
(licence forbids redistribution).
`;
}

/* ── helpers ─────────────────────────────────────────────────────────────*/
const exists = (p) => fs.access(p).then(() => true, () => false);
async function dirSize(dir) {
  let total = 0;
  for (const f of await fs.readdir(dir)) total += (await fs.stat(path.join(dir, f))).size;
  return total;
}

/* ── main ────────────────────────────────────────────────────────────────*/
const manifest = { version: 2, license: LICENSE, materials: [], props: [], hdris: [], models: [] };
const prev = await fs.readFile(path.join(OUT, 'manifest.json'), 'utf8').then(JSON.parse, () => null);

if (want('materials')) {
  log(`\nMaterials — ambientCG (CC0), ${MATERIALS.length} sets`);
  for (const m of MATERIALS) manifest.materials.push(await buildMaterial(m));
} else if (prev) manifest.materials = prev.materials;

if (want('hdri')) {
  log(`\nHDRI — Poly Haven (CC0)`);
  for (const h of HDRIS) manifest.hdris.push(await buildHdri(h));
} else if (prev) manifest.hdris = prev.hdris;

if (want('props')) {
  log(`\nProps — Poly Haven (CC0), ${PROPS.length} models`);
  for (const p of PROPS) {
    try { manifest.props.push(await buildProp(p)); }
    catch (e) { console.error(`  ✗ ${p.id}: ${e.message}`); }
  }
} else if (prev) manifest.props = prev.props;

if (want('models')) {
  log(`\nModels — Quaternius (CC0), ${MODEL_PACKS.length} packs`);
  for (const pk of MODEL_PACKS) {
    try { manifest.models.push(...await buildModelPack(pk)); }
    catch (e) { console.error(`  ✗ ${pk.id}: ${e.message}`); }
  }
} else if (prev) manifest.models = prev.models ?? [];

/*
 * Supplied models are recorded, never fetched. The baked GLB is committed, so
 * all this does is confirm it is still there and put it in the manifest — with
 * its provenance kept distinct from the CC0 libraries.
 */
for (const m of LOCAL_MODELS) {
  if (await exists(path.join(OUT, m.file))) {
    manifest.models.push({ pack: m.pack, slot: m.slot, source: m.source, file: m.file,
      scale: m.scale ?? 1, name: m.name, use: m.use, note: m.note });
    log(`  ✓ ${(m.pack + '/' + m.slot).padEnd(20)} supplied  ${mb((await fs.stat(path.join(OUT, m.file))).size)}`);
  } else {
    console.error(`  ✗ ${m.pack}/${m.slot}: ${m.file} is missing — rebuild it with tools/fbx-to-glb.mjs then tools/bake-glb.mjs`);
  }
}

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(ROOT, 'CREDITS.md'), writeCredits(manifest));

const total = await (async function walk(d) {
  let n = 0;
  for (const e of await fs.readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? await walk(p) : (await fs.stat(p)).size;
  }
  return n;
})(OUT);

log(`\n${manifest.materials.length} materials · ${manifest.props.length} props · ${manifest.hdris.length} HDRI · ${manifest.models.length} models`);
log(`assets/ total: ${mb(total)}`);
log('wrote assets/manifest.json and CREDITS.md');
