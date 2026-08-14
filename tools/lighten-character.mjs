/**
 * Bring a generated character down to a size a game can carry.
 *
 *   node tools/lighten-character.mjs <in.glb> <out.glb> [tris] [texpx]
 *
 * AI character generators export for a turntable, not for a level. A single
 * figure from Meshy arrives as 400,000 triangles carrying three 2048² JPEGs —
 * roughly twenty megabytes, for one man who will occupy forty pixels of screen
 * while someone shoots at him. The whole drawn scene here is budgeted at
 * 450,000 triangles and the entire asset payload at twenty-two megabytes, so
 * one untouched character is the entire frame and one is the entire download.
 *
 * Three reductions, in the order that matters:
 *
 *   WELD       A generated mesh is usually split at every UV seam and often
 *              at every triangle. Simplification cannot collapse an edge whose
 *              two sides are formally different vertices, so without this the
 *              reducer politely does nothing and reports success.
 *
 *   SIMPLIFY   meshoptimizer, down to the triangle budget. The error bound is
 *              deliberately loose and borders are not locked: this is a closed
 *              organic shape with no open edges to protect, and preserving
 *              silhouette detail nobody will ever see at this distance is how
 *              you end up spending eight thousand triangles on a shoelace.
 *
 *   TEXTURE    One base colour map, resized and re-encoded. The normal and
 *              roughness maps go entirely — ART.md puts this game on flat
 *              colour with a single roughness value, and a normal map baked
 *              from a 400k mesh onto a 5k one is noise with a filesize.
 *
 * What comes out is around a five-hundredth of what went in and looks the
 * same from three metres away, which is the only distance that exists here.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , SRC, OUT, TRIS = '6000', TEXPX = '512'] = process.argv;
if (!SRC || !OUT) {
  console.error('usage: lighten-character.mjs <in.glb> <out.glb> [tris] [texpx]');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();

const triCount = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce(
  (k, p) => k + (p.getIndices() ? p.getIndices().getCount() / 3
    : p.getAttribute('POSITION').getCount() / 3), 0), 0);

const before = triCount();
await MeshoptSimplifier.ready;

await doc.transform(
  dedup(),
  weld(),
  simplify({
    simplifier: MeshoptSimplifier,
    ratio: Math.max(0.002, Number(TRIS) / before),
    error: 0.008,
    lockBorder: false,
  }),
);
const after = triCount();

/*
 * Everything but base colour, gone.
 *
 * A generated character ships base colour, normal and metallic-roughness at
 * 2048² each. Two of those three are describing surface detail that was
 * simplified away thirty lines ago, and the third is the only one this game's
 * art direction uses. Dropping the material's references first means `prune`
 * can remove the images themselves rather than leaving them orphaned in the
 * binary.
 */
let dropped = 0;
for (const mat of root.listMaterials()) {
  for (const slot of ['NormalTexture', 'OcclusionTexture', 'MetallicRoughnessTexture',
    'EmissiveTexture']) {
    if (mat[`get${slot}`]?.()) { mat[`set${slot}`](null); dropped++; }
  }
  mat.setRoughnessFactor(0.82);
  mat.setMetallicFactor(0.0);
}

await doc.transform(
  prune({ keepAttributes: false }),
  textureCompress({
    encoder: sharp, targetFormat: 'webp',
    resize: [Number(TEXPX), Number(TEXPX)], quality: 88,
  }),
  /*
   * JOINTS/WEIGHTS are deliberately outside the quantize pattern. These
   * models are unrigged today, but they go on to `rebind-character.py` and
   * quantized skin weights come back out of a re-bind wrong.
   */
  quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|TANGENT)/ }),
);

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, await io.writeBinary(doc));

const size = (await fs.stat(OUT)).size;
const wasSize = (await fs.stat(SRC)).size;
console.log(
  `${path.basename(SRC).slice(0, 34).padEnd(36)} ` +
  `${before.toLocaleString()} → ${after.toLocaleString()} tris   ` +
  `${(wasSize / 1e6).toFixed(1)} → ${(size / 1e6).toFixed(2)} MB   ` +
  `(${dropped} maps dropped)`);
