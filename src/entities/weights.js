/**
 * Throw out skin weights that disagree with the surface around them.
 *
 * ── what this is fixing ──
 *
 * The police body is a supplied model re-bound onto this project's rig by
 * `tools/rebind-character.py`. The re-bind is mostly good and, in one place,
 * badly wrong: a run of vertices across the right arm and the right thigh came
 * out weighted 100% to `Head`.
 *
 * Nothing about that is visible in the bind pose — the mesh is intact, the
 * weights sum to one, every check the project had passed. It appears the
 * moment the skeleton moves, because a triangle with one corner on the head
 * and two on the forearm gets torn between them: a hundred-millimetre triangle
 * becomes a metre-and-a-quarter one. On screen that is a pale shard spearing
 * out of the officer, and every police figure in the game had several.
 *
 * ── two rules that did not work, and why ──
 *
 * The obvious rule is distance: a vertex belongs to the bone it sits on, so
 * throw out influences from bones far away. It fails on exactly the models
 * that need it. A re-bound body is not sewn to its skeleton — the police mesh
 * spans 2.03 m against a 1.6 m rig and sits systematically off it, so the
 * median vertex is already 19 cm from the nearest joint. Against that noise
 * floor a wrong weight is unremarkable.
 *
 * The second attempt kept distance only to name each vertex's "home" bone and
 * judged influences by how many joints away they were through the skeleton.
 * That is a better question, and it fails on the same fact: with the arms in
 * the pack's rest pose, the nearest bone to a hip vertex is a *thumb*. Naming
 * a home bone geometrically cannot work when the geometry does not line up,
 * and reassigning vertices to a wrongly-named home made the shards worse — 100
 * torn triangles became 181.
 *
 * ── the rule that does ──
 *
 * Skin weights vary smoothly across a surface. Neighbouring vertices on an arm
 * are bound to arm bones; they do not alternate between an arm and a skull.
 * So the reference for a vertex is not the skeleton at all — it is the ring of
 * vertices it shares triangles with. A vertex whose bones sit more than
 * `MAX_HOPS` joints away from what its neighbours agree on is wrong, and what
 * its neighbours agree on is what it should have had.
 *
 * This needs no correspondence between mesh and rig, which is the whole point:
 * it is exactly as valid on a body that was re-bound badly as on one that was
 * modelled to the rig. It runs in passes because a wrong patch agrees with
 * itself in the middle — each pass fixes the boundary ring and exposes the
 * next one, so a few passes eat inward until the patch is gone.
 */

import * as THREE from 'three';

const MAX_HOPS = 3;       // joints apart before two bones cannot both be right
const PASSES = 5;         // rings eaten inward from the edge of a bad patch
const SHAKES = 4;         // independent twists of the skeleton to test against
const SHAKE_ANGLE = 2.4;  // radians of twist per bone, per axis — a jog swings a thigh this far
const MAX_GROWTH = 0.12;  // metres an edge may gain under a shake and still be surface

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * How many joints apart every pair of bones is.
 *
 * Breadth-first from each bone over the parent/child graph, flattened to one
 * array. Sixty-five bones is 4225 bytes, built once per skeleton, and the
 * per-vertex work below is then a handful of lookups into it.
 */
function hopTable(bones) {
  const n = bones.length;
  const index = new Map(bones.map((b, i) => [b, i]));
  const adj = Array.from({ length: n }, () => []);
  bones.forEach((b, i) => {
    const p = index.get(b.parent);
    if (p !== undefined) { adj[i].push(p); adj[p].push(i); }
  });

  const hops = new Uint8Array(n * n).fill(255);
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    let head = 0, tail = 0;
    hops[s * n + s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      const cur = queue[head++];
      const d = hops[s * n + cur];
      for (const next of adj[cur]) {
        if (hops[s * n + next] !== 255) continue;
        hops[s * n + next] = Math.min(254, d + 1);
        queue[tail++] = next;
      }
    }
  }
  return hops;
}

/**
 * Who shares a triangle with whom, as a flat CSR-style pair of arrays.
 *
 * Built from the index buffer, so it is topological adjacency and not spatial:
 * two vertices at the same point either side of a UV seam are *not*
 * neighbours. That is the correct reading — a seam is where the surface is
 * genuinely cut — and it is why the passes below matter, since a seam slows
 * the spread of a correction by one ring.
 */
function adjacency(geometry, count) {
  const idx = geometry.index;
  const n = idx ? idx.count : geometry.attributes.position.count;
  const degree = new Uint32Array(count + 1);
  const at = (t) => (idx ? idx.getX(t) : t);

  for (let t = 0; t < n; t += 3) {
    degree[at(t)] += 2; degree[at(t + 1)] += 2; degree[at(t + 2)] += 2;
  }
  const start = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) start[i + 1] = start[i] + degree[i];
  const list = new Uint32Array(start[count]);
  const fill = start.slice(0, count);
  for (let t = 0; t < n; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    list[fill[a]++] = b; list[fill[a]++] = c;
    list[fill[b]++] = a; list[fill[b]++] = c;
    list[fill[c]++] = a; list[fill[c]++] = b;
  }
  return { start, list };
}

/**
 * The bone carrying the most weight on a vertex.
 * Returns -1 for a vertex with no weights at all.
 */
function dominant(sI, sW, i) {
  let best = -1, bestW = 0;
  for (let k = 0; k < 4; k++) {
    const w = sW.getComponent(i, k);
    if (w > bestW) { bestW = w; best = sI.getComponent(i, k); }
  }
  return best;
}

/**
 * Repair one skinned mesh in place.
 *
 * @returns {{vertices:number, fixed:number, passes:number, worst:?object}}
 */
export function repairSkinWeights(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const sI = geo.attributes.skinIndex;
  const sW = geo.attributes.skinWeight;
  const bones = mesh.skeleton?.bones;
  if (!pos || !sI || !sW || !bones?.length) {
    return { vertices: 0, fixed: 0, passes: 0, worst: null };
  }

  const n = bones.length;
  const hops = hopTable(bones);
  const { start, list } = adjacency(geo, pos.count);
  const dom = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) dom[i] = dominant(sI, sW, i);

  let fixed = 0, worst = null, passes = 0;

  for (let pass = 0; pass < PASSES; pass++) {
    /*
     * Find this pass's offenders before changing anything. Repairing in place
     * while still reading neighbours would let one corrected vertex vouch for
     * the next one along, and a bad patch would talk itself into being right.
     */
    const cure = [];
    for (let i = 0; i < pos.count; i++) {
      const mine = dom[i];
      if (mine < 0 || mine >= n) continue;

      /*
       * What the neighbours agree on: the bone whose neighbourhood — itself
       * and everything within MAX_HOPS of it — carries the most votes. Voting
       * by neighbourhood rather than by exact bone matters at joints, where an
       * elbow's ring legitimately splits between the upper arm and the forearm
       * and neither would win a straight count.
       */
      const votes = new Map();
      for (let e = start[i]; e < start[i + 1]; e++) {
        const d = dom[list[e]];
        if (d >= 0 && d < n) votes.set(d, (votes.get(d) ?? 0) + 1);
      }
      if (votes.size === 0) continue;

      let consensus = -1, best = 0, total = 0;
      for (const [bone] of votes) {
        let score = 0;
        for (const [other, count] of votes) {
          if (hops[bone * n + other] <= MAX_HOPS) score += count;
        }
        if (score > best) { best = score; consensus = bone; }
      }
      for (const count of votes.values()) total += count;

      // an ambiguous ring is a seam or a joint, not an error — leave it alone
      if (consensus < 0 || best < total * 0.6) continue;
      if (hops[consensus * n + mine] <= MAX_HOPS) continue;

      cure.push({ i, consensus, was: mine });
    }
    if (!cure.length) break;
    passes = pass + 1;

    for (const { i, consensus, was } of cure) {
      /*
       * Keep whatever influences are compatible with the consensus, and give
       * the rest of the vertex to the consensus bone. A vertex is rarely
       * entirely wrong — often three of its four influences are fine and one
       * is a skull — and keeping the good ones preserves the soft falloff that
       * makes a joint bend instead of hinge.
       */
      let kept = 0;
      for (let k = 0; k < 4; k++) {
        const w = sW.getComponent(i, k);
        if (w <= 0) continue;
        const bi = sI.getComponent(i, k);
        if (bi < n && hops[consensus * n + bi] <= MAX_HOPS) { kept += w; continue; }
        sW.setComponent(i, k, 0);
      }
      if (kept > 1e-4) {
        for (let k = 0; k < 4; k++) {
          const w = sW.getComponent(i, k);
          if (w > 0) sW.setComponent(i, k, w / kept);
        }
      } else {
        sI.setComponent(i, 0, consensus);
        sW.setComponent(i, 0, 1);
        for (let k = 1; k < 4; k++) sW.setComponent(i, k, 0);
      }
      const apart = hops[consensus * n + was];
      if (!worst || apart > worst.hops) {
        worst = {
          vertex: i, was: bones[was]?.name ?? `#${was}`,
          now: bones[consensus]?.name ?? `#${consensus}`, hops: apart, pass: pass + 1,
        };
      }
      fixed++;
    }
    for (const { i } of cure) dom[i] = dominant(sI, sW, i);
  }

  if (fixed) { sW.needsUpdate = true; sI.needsUpdate = true; }
  const cut = cutBridges(mesh);
  return { vertices: pos.count, fixed, passes, worst, cut };
}

/**
 * Shake the skeleton and delete whatever tears.
 *
 * ── why any triangle tears ──
 *
 * Re-weighting fixes a vertex bound to the wrong bone. It cannot fix a
 * triangle whose corners genuinely belong to different parts of the body, and
 * this pack has those. Chasing the last shards turned up why: the consensus
 * pass wanted to move a vertex off a *pinky* bone and onto a *thigh*, because
 * that vertex's neighbours in the mesh are thigh vertices. The hand and the
 * leg are joined.
 *
 * They are joined because the model reduction welds vertices by proximity, and
 * in this pack's rest pose the hands hang beside the hips a couple of
 * centimetres away. The weld cannot tell "the same point on one surface" from
 * "two surfaces touching", so it stitched each hand to the thigh behind it —
 * and the two thighs to each other, and the head into the chest. Invisible
 * standing still; a metre-long shard the moment anything swings.
 *
 * ── why the test is empirical ──
 *
 * The first version of this cut triangles whose corners were bound to bones
 * far apart in the skeleton, which is a good description of hand-welded-to-hip
 * and no description at all of thigh-welded-to-thigh: those bones are two
 * joints apart through the pelvis, as innocent a pair as exists. It removed a
 * third of the shards and left the rest.
 *
 * So the test is the symptom. Twist every bone by a different pseudo-random
 * amount, skin the mesh, and see what comes apart — repeated over a few
 * independent twists, so a pair that happens to move together in one is caught
 * by the next. Surface that belongs together stays together under any pose;
 * a stitch between two limbs cannot. It needs no theory about what the bones
 * mean, which is what makes it work on a body nobody rigged for this game.
 *
 * The twists run against the real skeleton, after the stylised build has
 * applied its bone scales, because those scales are part of what tears the
 * mesh: a head bone at 1.92 throws anything mistakenly weighted to it half a
 * metre.
 *
 * What is left behind is a small hole where two limbs were stitched — between
 * a wrist and a hip, or up under the chin — inside the silhouette, facing
 * nothing.
 *
 * The proper fix is upstream, in the reduction: weld with a tolerance below
 * the gap between the hands and the hips, or split the mesh by limb before
 * welding. That needs the original source asset, which this repository does
 * not have; this needs nothing and can be checked, so it holds the line.
 */
function cutBridges(mesh) {
  const geo = mesh.geometry;
  const idx = geo.index;
  const pos = geo.attributes.position;
  const bones = mesh.skeleton?.bones;
  if (!idx || !pos || !bones?.length) return 0;

  const rest = bones.map((b) => b.quaternion.clone());
  const doomed = new Uint8Array(idx.count / 3);
  const v = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const skinned = new Float32Array(pos.count * 3);
  const bind = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    bind[i * 3] = v.x; bind[i * 3 + 1] = v.y; bind[i * 3 + 2] = v.z;
  }

  for (let seed = 1; seed <= SHAKES; seed++) {
    /*
     * A deterministic pseudo-random twist on every bone. Not a real pose — the
     * point is only that no two bones move together, so anything that holds
     * still relative to its neighbours is one piece of surface and anything
     * that flies apart is not.
     */
    bones.forEach((bone, i) => {
      const h = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      _e.set((r - 0.5) * SHAKE_ANGLE,
        ((r * 7) % 1 - 0.5) * SHAKE_ANGLE,
        ((r * 13) % 1 - 0.5) * SHAKE_ANGLE);
      bone.quaternion.copy(rest[i]).multiply(_q.setFromEuler(_e));
    });
    mesh.skeleton.bones[0].updateMatrixWorld(true);
    mesh.skeleton.update();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      skinned[i * 3] = v.x; skinned[i * 3 + 1] = v.y; skinned[i * 3 + 2] = v.z;
    }
    for (let t = 0, tri = 0; t < idx.count; t += 3, tri++) {
      if (doomed[tri]) continue;
      const vi = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (let e = 0; e < 3; e++) {
        const i0 = vi[e], i1 = vi[(e + 1) % 3];
        a.set(bind[i0 * 3], bind[i0 * 3 + 1], bind[i0 * 3 + 2]);
        b.set(bind[i1 * 3], bind[i1 * 3 + 1], bind[i1 * 3 + 2]);
        const was = a.distanceTo(b);
        a.set(skinned[i0 * 3], skinned[i0 * 3 + 1], skinned[i0 * 3 + 2]);
        b.set(skinned[i1 * 3], skinned[i1 * 3 + 1], skinned[i1 * 3 + 2]);
        if (a.distanceTo(b) - was > MAX_GROWTH) { doomed[tri] = 1; break; }
      }
    }
  }

  bones.forEach((bone, i) => bone.quaternion.copy(rest[i]));
  mesh.skeleton.bones[0].updateMatrixWorld(true);
  mesh.skeleton.update();

  const kept = [];
  let cut = 0;
  for (let t = 0, tri = 0; t < idx.count; t += 3, tri++) {
    if (doomed[tri]) { cut++; continue; }
    kept.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
  }
  if (!cut) return 0;
  geo.setIndex(kept);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return cut;
}

/**
 * Repair every skinned mesh under a model, once.
 *
 * Marked on the object rather than tracked outside it, because bodies are
 * shared and cloned: repairing the source before anything is cloned fixes
 * every character built from it.
 */
export function repairModelWeights(root) {
  if (!root || root.userData.weightsRepaired) return null;
  root.userData.weightsRepaired = true;
  const report = [];
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const r = repairSkinWeights(o);
    if (r.fixed || r.cut) report.push({ mesh: o.name, ...r });
  });
  return report;
}
