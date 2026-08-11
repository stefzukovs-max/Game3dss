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
import { dedup, prune, weld, textureCompress, quantize } from '@gltf-transform/functions';
import { MATERIALS, PROPS, HDRIS, LICENSE, SOURCES } from './asset-manifest.js';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets');
const CACHE = path.join(os.tmpdir(), 'crosshill-asset-cache');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ONLY = (argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'materials,props,hdri').split(',');
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

**Quaternius character packs.** CC0, rigged and animated, and they would have
been fine to ship. They are stylised low-poly characters, though, and the brief
here was to move *away* from a blocky look, so adopting them would have worked
against the goal even though the licence is clean.

### What that means for the characters

There is no free, CC0, rigged, photorealistic human model that can be fetched
without an account. That is a real gap in the free-asset ecosystem, not an
oversight here: scanned humans are expensive to produce and the people who make
them sell them.

So the characters in this game are still the procedural rig in
\`src/entities/character.js\`. What the CC0 materials above buy them is
shading — real woven-cloth, denim-twill and leather-grain normal and roughness
maps over the existing per-outfit vertex colours, so clothing catches light like
fabric instead of like painted plastic. That is a genuine improvement and it is
also honestly less than a scanned character would be.
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
const manifest = { version: 1, license: LICENSE, materials: [], props: [], hdris: [] };
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

log(`\n${manifest.materials.length} materials · ${manifest.props.length} props · ${manifest.hdris.length} HDRI`);
log(`assets/ total: ${mb(total)}`);
log('wrote assets/manifest.json and CREDITS.md');
