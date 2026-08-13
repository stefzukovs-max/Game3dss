#!/usr/bin/env node
/**
 * Pull a photoscanned model into the stylised register.
 *
 *   node tools/stylise.mjs <in.glb> [out.glb] [--px=64] [--rough=0.9] [--metal=0]
 *
 * ART.md picked stylised low-poly over photoreal, and the meshes were never the
 * problem — after decimation a Poly Haven barrel is 400 triangles, which is a
 * perfectly good stylised barrel. What reads as photogrammetry is the *surface*:
 * a 512 px scanned albedo carrying real grime, a measured normal map, and a
 * roughness map full of detail that fights the flat shading this direction
 * wants.
 *
 * So three things happen here, and the first is the one that matters:
 *
 *   · **The base colour is resized to 64 px.** Not posterised, not replaced
 *     with a flat swatch — resized, which averages the scan into soft blocks of
 *     colour. A rusted drum stays rusty and stops being photographic. It also
 *     takes the texture from ~300 KB to about 2.
 *
 *   · **Normal and metallic-roughness maps are deleted.** Stylised shading
 *     takes form from geometry and light. A normal map here is detail the
 *     direction is trying not to have, and a per-fragment texture fetch on a
 *     phone for the privilege.
 *
 *   · **Roughness and metalness become single values**, per ART.md's table.
 *
 * Deliberately reversible: it reads a baked GLB and writes a new one, so the
 * decision can be undone by re-running `npm run assets -- --force`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';

const [, , IN, ...rest] = process.argv;
if (!IN) { console.error('usage: stylise.mjs <in.glb> [out.glb] [--px=N]'); process.exit(1); }
const OUT = rest.find((a) => !a.startsWith('--')) ?? IN;
const num = (k, d) => {
  const a = rest.find((x) => x.startsWith(`--${k}=`));
  return a ? Number(a.split('=')[1]) : d;
};
const PX = num('px', 64);
const ROUGH = num('rough', 0.9);
const METAL = num('metal', 0);

// measured before anything is written, because the default output path is the
// input path and statting it afterwards reports the new size as the old one
const inSize = (await fs.stat(IN)).size;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot();

let dropped = 0, shrunk = 0;
for (const mat of root.listMaterials()) {
  // the maps that carry photographic detail, and the ones the direction wants gone
  for (const setter of ['setNormalTexture', 'setMetallicRoughnessTexture',
    'setOcclusionTexture', 'setEmissiveTexture']) {
    if (typeof mat[setter] === 'function') { mat[setter](null); dropped++; }
  }
  mat.setRoughnessFactor(ROUGH);
  mat.setMetallicFactor(METAL);
}

for (const tex of root.listTextures()) {
  // anything still referenced after the above is a base colour
  const img = tex.getImage();
  if (!img) continue;
  const out = await sharp(Buffer.from(img))
    // `fit: fill` with a small target is the averaging: it is a box filter down
    // to 64 px, which is what turns a photograph into blocks of colour
    .resize(PX, PX, { fit: 'fill', kernel: 'cubic' })
    .webp({ quality: 90 })
    .toBuffer();
  tex.setImage(out).setMimeType('image/webp');
  shrunk++;
}

await doc.transform(prune(), dedup());
await fs.mkdir(path.dirname(path.resolve(OUT)), { recursive: true });
await fs.writeFile(OUT, await io.writeBinary(doc));

const outSize = (await fs.stat(OUT)).size;
console.log(`  ${path.basename(OUT).padEnd(30)} ${shrunk} tex → ${PX}px, ${dropped} maps dropped  ` +
  `${(inSize / 1e6).toFixed(2)} → ${(outSize / 1e6).toFixed(3)} MB`);
