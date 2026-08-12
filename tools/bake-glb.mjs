#!/usr/bin/env node
/**
 * Bake a raw GLB down to something a browser can stream.
 *
 *   node tools/bake-glb.mjs <in.glb> <out.glb> [--size=1024] [--ratio=0.35]
 *
 * The same cleanup `fetch-assets.mjs` runs on everything it downloads, exposed
 * as a standalone step for models that arrive by hand rather than from a
 * manifest — a supplied FBX has usually been built for a render, not a game,
 * and lands here at a quarter of a million triangles with 4K maps.
 *
 * `simplify` is the one addition. It is deliberately conservative and locks the
 * mesh borders: a car is a shell of separate panels, and letting the simplifier
 * move boundary vertices tears visible gaps between them.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , IN, OUT, ...rest] = process.argv;
if (!IN || !OUT) { console.error('usage: bake-glb.mjs <in.glb> <out.glb> [--size=N] [--ratio=R]'); process.exit(1); }
const arg = (k, d) => { const a = rest.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const SIZE = arg('size', 1024);
const RATIO = arg('ratio', 1);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);

const count = (d) => d.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
const before = count(doc);

await MeshoptSimplifier.ready;

/*
 * `--ratio=1` skips decimation entirely, and that is the right default for
 * anything panelled.
 *
 * A car is not one surface: it is thirty separate shells — doors, glass, trim,
 * wheels — that share no edges. A simplifier has no way to know a wheel arch is
 * structural, so at 0.3 it eats the body into a wedge and leaves the wheels
 * floating beside it. Texture compression and quantization are where the real
 * saving is anyway: they took this model from 28 MB to under one, with the
 * geometry untouched.
 */
const steps = [dedup(), prune({ keepAttributes: false }), weld()];
if (RATIO < 1) {
  steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.0008, lockBorder: true }));
}
steps.push(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [SIZE, SIZE], quality: 84 }),
  quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|TANGENT)/ }),
);
await doc.transform(...steps);

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, await io.writeBinary(doc));
const after = count(doc);
console.log(`  ${path.basename(OUT)}  ${Math.round(before)} → ${Math.round(after)} tris  ` +
  `${((await fs.stat(IN)).size / 1e6).toFixed(1)} → ${((await fs.stat(OUT)).size / 1e6).toFixed(2)} MB`);
