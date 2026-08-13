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
import { dedup, flatten, join, prune, weld, simplify, textureCompress, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , IN, OUT, ...rest] = process.argv;
if (!IN || !OUT) { console.error('usage: bake-glb.mjs <in.glb> <out.glb> [--size=N] [--ratio=R]'); process.exit(1); }
const arg = (k, d) => { const a = rest.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const SIZE = arg('size', 1024);
const RATIO = arg('ratio', 1);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);

const meshCount = (d) => d.getRoot().listMeshes()
  .reduce((n, m) => n + m.listPrimitives().length, 0);
const count = (d) => d.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
const before = count(doc);
const beforeMeshes = meshCount(doc);

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
/*
 * `flatten` + `join` before anything else, and they are the reason this file
 * exists as much as the compression is.
 *
 * A modelled vehicle arrives as a node tree of separate objects — panels,
 * glass, lights, each wheel nut — and three.js issues one draw call per mesh
 * per material. The supplied armoured van was 112 meshes, so three of them
 * parked at the foot of the hill cost 336 draw calls on their own, more than
 * half the frame's entire budget, for one vehicle model.
 *
 * `flatten` bakes the node transforms into the geometry so the hierarchy stops
 * mattering; `join` then merges every primitive that shares a material. The
 * van comes out as one mesh per material and the draw cost collapses with it.
 * Nothing about how it looks changes, because a draw call is not a feature.
 *
 * `--keep-hierarchy` opts out, for a model whose parts have to move separately.
 */
const steps = [dedup(), prune({ keepAttributes: false })];
if (!rest.includes('--keep-hierarchy')) steps.push(flatten(), join());
steps.push(weld());
/*
 * `lockBorder` defaults on, and after a `join` that is usually the wrong
 * default: joining merges every shell that shares a material into one
 * primitive, `weld` then turns the seams between them into interior edges, and
 * what is left locked is the model's genuinely open boundary. Locking that
 * stops the simplifier reaching any target at all — the armoured van moved
 * 31,402 → 28,348 at a requested ratio of 0.38. `--unlock` lets it go.
 */
if (RATIO < 1) {
  steps.push(simplify({
    simplifier: MeshoptSimplifier, ratio: RATIO,
    error: rest.includes('--unlock') ? 0.01 : 0.0008,
    lockBorder: !rest.includes('--unlock'),
  }));
}
/*
 * `--join-only` skips texture work, for re-processing a file this tool already
 * baked. Re-encoding an 84-quality WebP to 84-quality WebP is a second round of
 * lossy compression for no size saving, and it is worth having a way to fix a
 * model's draw-call cost without paying for it in image quality.
 */
if (!rest.includes('--join-only')) {
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [SIZE, SIZE], quality: 84 }));
}
steps.push(quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|TANGENT)/ }));
await doc.transform(...steps);

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, await io.writeBinary(doc));
const after = count(doc);
console.log(`  ${path.basename(OUT)}  ${Math.round(before)} → ${Math.round(after)} tris  ` +
  `${beforeMeshes} → ${meshCount(doc)} draws  ` +
  `${((await fs.stat(IN)).size / 1e6).toFixed(1)} → ${((await fs.stat(OUT)).size / 1e6).toFixed(2)} MB`);
