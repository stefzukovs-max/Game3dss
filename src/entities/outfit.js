import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  DRESSING THE RIG
 * ══════════════════════════════════════════════════════════════════
 *
 * The CC0 character pack ships six rigged bodies and no clothes. There is no
 * CC0 outfit set anywhere that shares this skeleton — the only modular outfit
 * pack built for it is fantasy armour — so the clothing is cut here, out of the
 * body itself.
 *
 * ── how ──
 * A garment is a copy of the region of the body it covers, pushed a centimetre
 * or two along its own normals. Because it is literally the same vertices, it
 * arrives with the pack's skin weights already on it and deforms exactly as the
 * body does: no rigging, no retargeting, and nothing to go out of sync when the
 * animation library drives the skeleton. Thickness is what separates a vest
 * from a shirt from a bare arm.
 *
 * Two things decide what a garment covers:
 *
 *   · **Bone regions** give the soft boundaries. A shirt is "whatever is
 *     weighted to the spine and the clavicles" — which follows the anatomy for
 *     free, so the armhole lands on the shoulder rather than on a Y plane
 *     through it.
 *
 *   · **Cuts** give the hard ones. Hems, collars and sleeve ends are straight
 *     lines on a real garment, so they are straight lines here: a plane in rest
 *     space, with the triangles that straddle it snapped flat against it rather
 *     than dropped. Dropping them is the obvious implementation and it leaves a
 *     hem that wanders by a triangle edge — about two centimetres, which is
 *     precisely the scale at which a uniform stops looking issued.
 *
 * ── why it is cheap ──
 * Every garment for a preset is merged into one vertex-coloured mesh and cached
 * against the preset name, so the whole battalion shares one clothing geometry
 * and one material, and a dressed character costs two extra draw calls rather
 * than eight.
 */

/* ── shared state ─────────────────────────────────────────────────── */
const KIT_CACHE = new Map();     // outfit.preset -> { cloth, gear }
const MAT_CACHE = new Map();     // kind -> Material
const GEAR_GEO = new Map();      // gear part -> BufferGeometry
let FABRIC = null;               // woven normal map
let HIDE = null;                 // leather normal map
let HAIR_SOURCE = null;          // hairstyles rigged to the head bone

/** Hand the outfit system the scanned cloth maps, once the library is up. */
export function setOutfitMaterials(assets) {
  const wrap = (t, repeat) => {
    if (!t) return null;
    const c = t.clone();
    c.needsUpdate = true;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(repeat, repeat);
    return c;
  };
  FABRIC = wrap(assets?.material('cloth')?.normal, 8);
  HIDE = wrap(assets?.material('leather')?.normal, 10);
  MAT_CACHE.clear();

  const hair = (slot) => assets?.models.get(`people:${slot}`) ?? null;
  const styles = ['hair_buzz', 'hair_part', 'hair_long'].map(hair).filter(Boolean);
  HAIR_SOURCE = styles.length || hair('beard')
    ? { styles, buzz: hair('hair_buzz'), beard: hair('beard') }
    : null;
}

/**
 * Cloth and gear differ in roughness and in how hard the microsurface reads,
 * which is most of what separates a cotton shirt from a nylon plate carrier at
 * a distance. Colour comes per-vertex so one material dresses everyone.
 */
function material(kind) {
  const hit = MAT_CACHE.get(kind);
  if (hit) return hit;

  const cloth = kind === 'cloth';
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: cloth ? 0.94 : 0.62,
    metalness: 0,
    envMapIntensity: cloth ? 0.7 : 0.9,
    side: cloth ? THREE.DoubleSide : THREE.FrontSide,
  });
  /*
   * Garment shells are open at the hems, so the cloth pass is double-sided:
   * at a grazing angle a single-sided shirt shows the inside of its own back
   * through the neck hole.
   */
  const map = cloth ? FABRIC : HIDE;
  if (map) {
    m.normalMap = map;
    m.normalScale = new THREE.Vector2(cloth ? 0.55 : 0.7, cloth ? 0.55 : 0.7);
  }
  MAT_CACHE.set(kind, m);
  return m;
}

/* ── rest space ───────────────────────────────────────────────────── */

/**
 * The transform from stored vertex values to metres.
 *
 * The pack is shipped quantized, so `position` holds normalised shorts, not
 * metres — reading it straight gives a body two units wide. For a skinned mesh
 * the dequantisation cannot live on the node (the node transform is ignored in
 * favour of the skeleton), so it is folded into the inverse bind matrices,
 * which means every bone's bind-pose skinning matrix is the *same* matrix: the
 * dequantisation itself. Recovering it from bone zero is therefore exact, not
 * an approximation, and it is the only way to know what a centimetre is here.
 */
function restMatrix(mesh) {
  const bone = mesh.skeleton.bones[0];
  bone.updateWorldMatrix(true, false);
  return new THREE.Matrix4()
    .copy(mesh.bindMatrixInverse)
    .multiply(bone.matrixWorld)
    .multiply(mesh.skeleton.boneInverses[0])
    .multiply(mesh.bindMatrix)
    .premultiply(mesh.matrixWorld);
}

/* ── proportions ──────────────────────────────────────────────────── */

/**
 * Per-bone reshaping, as a scale about a point on the bone's own axis.
 *
 * The pack's body is called "Superhero" and is built like one: deltoids the
 * size of melons, a wasp waist and a 1.86 m arm span on a 1.82 m man. Dressed,
 * that reads as a bodybuilder in body paint rather than as somebody who lives
 * on this hill, and no amount of work on the clothing fixes it — the clothing
 * is cut from this surface, so it inherits every bulge.
 *
 * Each bone contracts the mesh around itself, perpendicular to its own run: the
 * arms lie along X in the bind pose so they take (1, k, k), the torso and legs
 * stand along Y so they take (k, 1, k). Because every centre is a point *on*
 * the bone, the bone stays the axis of its limb and the skeleton does not have
 * to move with the skin — rotating a thinner arm still works exactly as before.
 *
 * The result is blended by skin weight, the same way skinning is, so the
 * transitions come out smooth rather than stepping at every joint.
 */
const SHAPE = {
  neck_01:    { c: [0, 1.520, -0.041], s: [0.90, 1, 0.90] },
  clavicle_l: { c: [0.031, 1.495, 0.033], s: [1, 0.90, 0.92] },
  clavicle_r: { c: [-0.031, 1.495, 0.033], s: [1, 0.90, 0.92] },
  upperarm_l: { c: [0.212, 1.455, -0.065], s: [1, 0.76, 0.76] },
  upperarm_r: { c: [-0.212, 1.455, -0.065], s: [1, 0.76, 0.76] },
  lowerarm_l: { c: [0.463, 1.455, -0.073], s: [1, 0.84, 0.84] },
  lowerarm_r: { c: [-0.463, 1.455, -0.073], s: [1, 0.84, 0.84] },
  hand_l:     { c: [0.706, 1.455, -0.065], s: [1, 0.94, 0.94] },
  hand_r:     { c: [-0.706, 1.455, -0.065], s: [1, 0.94, 0.94] },
  spine_03:   { c: [0, 1.311, 0.007], s: [0.90, 1, 0.93] },
  spine_02:   { c: [0, 1.178, 0.004], s: [0.96, 1, 0.98] },
  spine_01:   { c: [0, 1.072, -0.007], s: [1.04, 1, 1.03] },
  pelvis:     { c: [0, 0.949, -0.043], s: [1.02, 1, 1.00] },
  thigh_l:    { c: [0.114, 0.971, -0.036], s: [0.91, 1, 0.91] },
  thigh_r:    { c: [-0.114, 0.971, -0.036], s: [0.91, 1, 0.91] },
  calf_l:     { c: [0.114, 0.542, -0.036], s: [0.89, 1, 0.89] },
  calf_r:     { c: [-0.114, 0.542, -0.036], s: [0.89, 1, 0.89] },
};

/**
 * Reshape the shared body once, in place.
 *
 * Runs on the source mesh before anything is cut from it, so the clothing
 * inherits the new proportions for free.
 *
 * Normals are transformed rather than recomputed. `computeVertexNormals` would
 * be the obvious call and it splits the normal at every UV seam, which puts a
 * visible crease down the side of the head and along both arms — the authored
 * normals are already smooth across those seams, and a non-uniform scale
 * carries them correctly through its own inverse.
 */
export function reshapeBody(root) {
  const src = bodyMesh(root);
  if (!src || src.userData.reshaped) return false;

  const skins = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  src.updateWorldMatrix(true, false);
  const toRest = restMatrix(src);
  const toAttr = toRest.clone().invert();
  // direction-only forms of the same two transforms, for the normals
  const dirToRest = new THREE.Matrix3().setFromMatrix4(toRest);
  const dirToAttr = new THREE.Matrix3().setFromMatrix4(toAttr);

  for (const mesh of skins) {
    const names = mesh.skeleton.bones.map((b) => b.name);
    const table = names.map((n) => SHAPE[n] ?? null);
    if (!table.some(Boolean)) continue;

    const pos = mesh.geometry.attributes.position;
    const nor = mesh.geometry.attributes.normal;
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    const n = pos.count;
    const P = new Float32Array(n * 3);
    const N = new Float32Array(n * 3);
    const p = new THREE.Vector3();
    const out = new THREE.Vector3();
    const nv = new THREE.Vector3();
    const acc = [0, 0, 0];

    for (let i = 0; i < n; i++) {
      p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toRest);
      out.set(0, 0, 0);
      acc[0] = acc[1] = acc[2] = 0;
      let total = 0;

      for (const k of ['X', 'Y', 'Z', 'W']) {
        const w = sw[`get${k}`](i);
        if (w <= 0) continue;
        const e = table[si[`get${k}`](i)];
        total += w;
        if (!e) { out.addScaledVector(p, w); acc[0] += w; acc[1] += w; acc[2] += w; continue; }
        out.x += w * (e.c[0] + e.s[0] * (p.x - e.c[0]));
        out.y += w * (e.c[1] + e.s[1] * (p.y - e.c[1]));
        out.z += w * (e.c[2] + e.s[2] * (p.z - e.c[2]));
        acc[0] += w * e.s[0]; acc[1] += w * e.s[1]; acc[2] += w * e.s[2];
      }
      if (total <= 0) { out.copy(p); acc[0] = acc[1] = acc[2] = 1; total = 1; }
      out.divideScalar(total).applyMatrix4(toAttr);
      P[i * 3] = out.x; P[i * 3 + 1] = out.y; P[i * 3 + 2] = out.z;

      /*
       * A normal under a diagonal scale S transforms by S⁻¹ — but S is written
       * in rest space and the stored normal is in the mesh's own space, which
       * the armature turns a quarter turn out of it. So the normal makes the
       * same round trip the position does.
       */
      nv.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(dirToRest);
      nv.set(nv.x / (acc[0] / total || 1), nv.y / (acc[1] / total || 1),
        nv.z / (acc[2] / total || 1)).applyMatrix3(dirToAttr).normalize();
      N[i * 3] = nv.x; N[i * 3 + 1] = nv.y; N[i * 3 + 2] = nv.z;
    }

    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(P, 3));
    mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }

  src.userData.reshaped = true;
  KIT_CACHE.clear();
  return true;
}

/* ── the cut list ─────────────────────────────────────────────────── */

/**
 * Bone groups, by the pack's own Unreal-style names.
 *
 * Spelled out rather than pattern-matched: a typo in a regex here silently
 * produces a garment with a hole in it, and a missing bone name is much easier
 * to see in a list.
 */
const B = {
  torso: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01'],
  chest: ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'],
  arms: ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'],
  hands: ['hand_l', 'hand_r'],
  legs: ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'],
  feet: ['calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r'],
  head: ['Head', 'neck_01'],
};
const FINGERS = ['index', 'middle', 'pinky', 'ring', 'thumb'];

/*
 * Heights are metres above the ground in the bind pose, measured off the rig:
 * head 1.60, neck 1.52, clavicle 1.50, shoulder 1.46, chest 1.31, waist 1.07,
 * hip 0.95, knee 0.54, ankle 0.09. The bind pose is a T-pose, so sleeve length
 * is a distance out along X, not a height: shoulder 0.21, elbow 0.46, wrist
 * 0.71.
 */
/**
 * A cut is a slab in rest space: `axis` in `[min, max]`.
 *
 * `clamp` says what happens to the part of the body outside it. `'min'` and
 * `'max'` snap it flat onto that face — the right behaviour for a hem, where
 * the garment genuinely stops and the edge should be straight. `false` drops
 * the triangle instead, which is what a boundary the garment does *not* cross
 * needs: clamping every remaining cut on a patch bounded on all four sides
 * folds the entire torso into the patch, and you get a bib.
 *
 * `only` scopes the cut to another slab. The bind pose is a T-pose, so a collar
 * height and an arm are at the same Y: without a scope, "the shirt stops at the
 * collarbone" also flattens both sleeves onto that plane.
 */
const y = (min, max, clamp = true, only = null) => ({ axis: 'y', min, max, clamp, only });
const sleeve = (max) => ({ axis: 'absx', max, clamp: 'max' });
/**
 * The neck column. Measured: the body is 0.08 m wide at the head, 0.24 m at the
 * base of the neck and 0.68 m across the shoulders, so a scope of 0.10 catches
 * the neck and nothing else — which is what a collar should be cut against. A
 * wider scope reaches the deltoid, and clamping the top of the shoulder down to
 * collar height tears a hole in the sleeve.
 */
const NECK = { axis: 'absx', max: 0.10 };
/** hem heights that need no scope, since nothing else is that low */
const hem = (min) => ({ axis: 'y', min, clamp: 'min' });
const collar = (max) => ({ axis: 'y', max, clamp: 'max', only: NECK });

/**
 * @returns the garment list for an outfit record.
 *
 * Exported so `tools/outfit-check.mjs` can report what each preset asks for
 * against what actually got cut — a garment that silently comes back empty
 * looks exactly like a garment nobody asked for.
 */
export function garmentPlan(o) { return garments(o); }

/** Per-garment triangle counts for a preset, once it has been cut. */
export function garmentStats(root, outfit) { return buildKit(bodyMesh(root), outfit).stats; }

function garments(o) {
  const g = [];
  const push = (s) => g.push(s);

  /* ── the crew ── */
  if (o.tank) {
    // no arms in the bone set, so the height cut shapes the straps directly
    push({ name: 'tank', kind: 'cloth', color: o.shirt, thick: 0.017, drape: 2,
      bones: B.torso, cuts: [hem(0.88), collar(1.50), sleeve(0.17)] });
  } else if (!o.hasVest) {
    push({ name: 'shirt', kind: 'cloth', color: o.shirt, thick: 0.028, drape: 3,
      bones: [...B.torso, ...B.arms],
      cuts: [hem(0.86), collar(1.53), sleeve(0.36)] });
  } else {
    // under a plate carrier the sleeves run long — combat shirt, not a T-shirt
    push({ name: 'combat shirt', kind: 'cloth', color: o.shirt, thick: 0.026, drape: 3,
      bones: [...B.torso, ...B.arms],
      cuts: [hem(0.88), collar(1.55), sleeve(0.68)] });
  }

  if (o.shorts) {
    push({ name: 'shorts', kind: 'cloth', color: o.pants, thick: 0.048, drape: 5,
      bones: B.legs, cuts: [y(0.60, 1.03)] });
  } else {
    push({ name: 'trousers', kind: 'cloth', color: o.pants, thick: 0.046, drape: 6,
      bones: B.legs, cuts: [y(0.11, 1.03)] });
  }

  /*
   * Footwear is modelled, not cut.
   *
   * A shell around the foot is a shrink-wrapped foot: it has toes, no sole and
   * no toe box, and it comes out looking like a sock. Feet barely deform, so a
   * boot can be a rigid object on the foot bone and have the one thing the
   * shell cannot — a shape of its own. Only the shaft, which crosses the ankle,
   * is still cut from the leg.
   */
  if (o.knees || o.shoes === 0x14161a) {
    push({ name: 'boot shaft', kind: 'gear', color: o.shoes ?? 0x14161a, thick: 0.028, drape: 2,
      bones: B.feet, cuts: [y(0.10, 0.30, 'max')] });
  }

  /* ── the battalion ── */
  if (o.vest) {
    /*
     * Only the bottom hem clamps. Left to clamp at the top as well, the
     * shoulders fold down into the vest and it stops reading as a carrier worn
     * over a shirt; unclamped, the chest weighting runs out at the base of the
     * neck on its own and leaves proper shoulder straps.
     */
    push({ name: 'plate carrier', kind: 'gear', color: o.vest, thick: 0.052, drape: 3,
      bones: B.chest, cuts: [hem(1.00), sleeve(0.20)] });
    if (o.sidePlates) {
      push({ name: 'side plates', kind: 'gear', color: o.vest, thick: 0.068,
        bones: B.chest,
        cuts: [y(1.06, 1.32, false), { axis: 'absx', min: 0.115, max: 0.20, clamp: false }] });
    }
    /*
     * The reflective band across the back. Bounded on all four sides, so every
     * cut drops rather than clamps: snapping the front of the chest back onto
     * the band's plane is what turns a band into a bib.
     */
    if (o.patch) {
      push({ name: 'reflective band', kind: 'gear', color: o.patch, thick: 0.050,
        bones: B.chest,
        cuts: [y(1.15, 1.29, false), { axis: 'absx', max: 0.155, clamp: false },
          { axis: 'z', max: -0.055, clamp: false }] });
    }
  }

  if (o.gloves) {
    push({ name: 'gloves', kind: 'gear', color: o.gloves, thick: 0.007,
      bones: [...B.hands, ...FINGERS], cuts: [{ axis: 'absx', min: 0.62, clamp: 'min' }] });
  }
  if (o.balaclava) {
    push({ name: 'balaclava', kind: 'cloth', color: o.balaclava, thick: 0.011, drape: 1,
      bones: B.head, cuts: [hem(1.56)] });
  } else if (o.head === 'bandana') {
    push({ name: 'bandana', kind: 'cloth', color: o.bandana, thick: 0.008,
      bones: B.head, cuts: [hem(1.74)] });
  } else if (o.head === 'hood') {
    push({ name: 'hood', kind: 'cloth', color: o.hood, thick: 0.042, drape: 4,
      bones: [...B.head, ...B.chest], cuts: [hem(1.44)] });
  }
  if (o.face && o.head !== 'hood') {
    // a shirt or a bandana pulled up over the nose: straight along the bottom
    // where it meets the neck, ragged along the top because cloth is
    push({ name: 'face cover', kind: 'cloth', color: o.face, thick: 0.010,
      bones: B.head,
      cuts: [y(1.56, 1.70, 'min'), { axis: 'z', min: -0.01, clamp: false }] });
  }
  return g;
}

/* ── the cutter ───────────────────────────────────────────────────── */

/**
 * Cut one garment out of the body.
 *
 * @param {THREE.SkinnedMesh} src   the body, at bind pose
 * @param {object} spec             one entry from `garments()`
 * @param {Float32Array} rest       per-vertex rest position, metres
 * @param {THREE.Matrix4} toAttr    metres back to stored units
 */
function cutGarment(src, spec, rest, toAttr) {
  const g = src.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const idx = g.index;
  const count = idx ? idx.count : pos.count;

  /* which bones count as "inside" this garment */
  const names = src.skeleton.bones.map((b) => b.name);
  const wanted = new Uint8Array(names.length);
  for (let i = 0; i < names.length; i++) {
    if (spec.bones.some((n) => names[i] === n || names[i].startsWith(n + '_'))) wanted[i] = 1;
  }

  /* per-vertex: how much of this vertex belongs to the region */
  const n = pos.count;
  const mass = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    if (wanted[si.getX(i)]) m += sw.getX(i);
    if (wanted[si.getY(i)]) m += sw.getY(i);
    if (wanted[si.getZ(i)]) m += sw.getZ(i);
    if (wanted[si.getW(i)]) m += sw.getW(i);
    mass[i] = m;
  }

  /*
   * Per-vertex cut state, and the clamped rest position for the vertices that
   * fall outside. A vertex is clamped the same way for every triangle that uses
   * it, so this can be decided once here rather than per triangle.
   */
  const inside = new Uint8Array(n);
  const dropped = new Uint8Array(n);
  const fixed = new Float32Array(n * 3);
  const axisOf = (c, X, Y, Z) => (c.axis === 'y' ? Y : c.axis === 'z' ? Z : Math.abs(X));
  for (let i = 0; i < n; i++) {
    const ox = rest[i * 3], oy = rest[i * 3 + 1], oz = rest[i * 3 + 2];
    let px = ox, py = oy, pz = oz;
    let ok = 1;
    for (const c of spec.cuts) {
      // scopes read the untouched position: an earlier clamp must not move a
      // vertex into or out of a later cut's remit
      if (c.only) {
        const s = axisOf(c.only, ox, oy, oz);
        if (s < (c.only.min ?? -Infinity) || s > (c.only.max ?? Infinity)) continue;
      }
      const v = axisOf(c, px, py, pz);
      const lo = c.min ?? -Infinity, hi = c.max ?? Infinity;
      if (v >= lo && v <= hi) continue;

      ok = 0;
      const side = v < lo ? 'min' : 'max';
      if (c.clamp !== true && c.clamp !== side) { dropped[i] = 1; break; }
      const t = side === 'min' ? lo : hi;
      if (c.axis === 'y') py = t;
      else if (c.axis === 'z') pz = t;
      else px = Math.sign(px || 1) * t;
    }
    inside[i] = ok;
    fixed[i * 3] = px; fixed[i * 3 + 1] = py; fixed[i * 3 + 2] = pz;
  }

  /* keep a triangle when the whole of it is in the region and some of it is
   * within the cuts — the rest gets pulled onto the cut plane */
  const keep = [];
  const at = (k) => (idx ? idx.getX(k) : k);
  for (let k = 0; k < count; k += 3) {
    const a = at(k), b = at(k + 1), c = at(k + 2);
    if (mass[a] < 0.5 || mass[b] < 0.5 || mass[c] < 0.5) continue;
    if (dropped[a] || dropped[b] || dropped[c]) continue;
    if (!inside[a] && !inside[b] && !inside[c]) continue;
    keep.push(a, b, c);
  }
  if (!keep.length) return null;

  /* compact to the vertices actually used */
  const remap = new Int32Array(n).fill(-1);
  const order = [];
  for (const v of keep) if (remap[v] < 0) { remap[v] = order.length; order.push(v); }

  const m = order.length;
  const P = new Float32Array(m * 3);
  const N = new Float32Array(m * 3);
  const U = new Float32Array(m * 2);
  const SI = new Uint16Array(m * 4);
  const SW = new Float32Array(m * 4);
  const C = new Float32Array(m * 3);

  // vertex colours live in the renderer's working space, as everywhere else
  const col = new THREE.Color().setHex(spec.color ?? 0x808080, THREE.SRGBColorSpace);
  const p = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const thick = spec.thick / metresPerUnit(toAttr);

  for (let j = 0; j < m; j++) {
    const v = order[j];

    nv.set(nor.getX(v), nor.getY(v), nor.getZ(v)).normalize();
    // the cut position is in metres; the mesh stores normalised units, and the
    // thickness has to be converted with it or a 1.5 cm shirt becomes a tent
    p.set(fixed[v * 3], fixed[v * 3 + 1], fixed[v * 3 + 2]).applyMatrix4(toAttr);
    p.addScaledVector(nv, thick);

    P[j * 3] = p.x; P[j * 3 + 1] = p.y; P[j * 3 + 2] = p.z;
    N[j * 3] = nv.x; N[j * 3 + 1] = nv.y; N[j * 3 + 2] = nv.z;
    U[j * 2] = uv.getX(v); U[j * 2 + 1] = uv.getY(v);
    SI[j * 4] = si.getX(v); SI[j * 4 + 1] = si.getY(v);
    SI[j * 4 + 2] = si.getZ(v); SI[j * 4 + 3] = si.getW(v);
    SW[j * 4] = sw.getX(v); SW[j * 4 + 1] = sw.getY(v);
    SW[j * 4 + 2] = sw.getZ(v); SW[j * 4 + 3] = sw.getW(v);
    C[j * 3] = col.r; C[j * 3 + 1] = col.g; C[j * 3 + 2] = col.b;
  }

  if (spec.drape) relax(P, keep, remap, spec.drape, spec.thick / metresPerUnit(toAttr));

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setIndex(keep.map((v) => remap[v]));
  return out;
}

/**
 * Let a garment hang instead of tracing the body.
 *
 * A shell offset along the body's normals is a perfect cast of it, so the
 * abdominals show through the shirt and the trousers read as leggings — which
 * is most of why this looked like body paint. Averaging each vertex against its
 * neighbours a few times relaxes the surface off the muscle relief and leaves
 * the garment's own shape: the silhouette a shirt has because it hangs from the
 * shoulders rather than because of what is under it.
 *
 * Laplacian smoothing shrinks whatever it touches, and a garment that shrinks
 * ends up inside the body, so the lost thickness is pushed back out along the
 * surface's own direction afterwards.
 */
function relax(P, keep, remap, iterations, thick) {
  const m = P.length / 3;
  const sum = new Float32Array(m * 3);
  const deg = new Uint16Array(m);
  const edge = (a, b) => {
    sum[a * 3] += P[b * 3]; sum[a * 3 + 1] += P[b * 3 + 1]; sum[a * 3 + 2] += P[b * 3 + 2];
    deg[a]++;
  };

  const before = P.slice();
  for (let pass = 0; pass < iterations; pass++) {
    sum.fill(0); deg.fill(0);
    for (let k = 0; k < keep.length; k += 3) {
      const a = remap[keep[k]], b = remap[keep[k + 1]], c = remap[keep[k + 2]];
      edge(a, b); edge(a, c); edge(b, a); edge(b, c); edge(c, a); edge(c, b);
    }
    for (let i = 0; i < m; i++) {
      if (!deg[i]) continue;
      for (let j = 0; j < 3; j++) {
        // half way to the neighbourhood average: enough to lose the relief in
        // a few passes, gentle enough not to collapse a sleeve
        P[i * 3 + j] += 0.5 * (sum[i * 3 + j] / deg[i] - P[i * 3 + j]);
      }
    }
  }

  // restore the clearance smoothing ate, along the direction it moved
  for (let i = 0; i < m; i++) {
    let dx = P[i * 3] - before[i * 3];
    let dy = P[i * 3 + 1] - before[i * 3 + 1];
    let dz = P[i * 3 + 2] - before[i * 3 + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) continue;
    const push = Math.min(d, thick * 0.9);
    P[i * 3] -= (dx / d) * push;
    P[i * 3 + 1] -= (dy / d) * push;
    P[i * 3 + 2] -= (dz / d) * push;
  }
}

/**
 * How many metres one stored unit is worth.
 *
 * The dequantisation is a similarity, so a single number describes it — and
 * `toAttr` runs the other way, hence the reciprocal.
 */
const _sv = new THREE.Vector3();
function metresPerUnit(toAttr) {
  return 1 / _sv.setFromMatrixColumn(toAttr, 0).length();
}

/* ── rigid gear ───────────────────────────────────────────────────── */

/**
 * Hardware does not deform, so it is not cut out of the body: it is modelled
 * and hung off a bone. A helmet that stretched with the neck would look far
 * worse than one that is simply rigid.
 */
function gearGeo(name, build) {
  let g = GEAR_GEO.get(name);
  if (!g) { g = build(); GEAR_GEO.set(name, g); }
  return g;
}

const box = (w, h, d, r = 0) => new THREE.BoxGeometry(w, h, d, 1, 1, 1)
  .translate(0, r, 0);

/**
 * A mount point on a bone, in character space.
 *
 * Bones inherit the rig's own axis convention — X down the bone, arbitrary roll
 * — so anything parented straight to one arrives rotated by whatever the
 * animator's skeleton happened to use. This cancels the bone's rest rotation,
 * so gear can be modelled the obvious way (Y up, +Z forward) and still ride the
 * bone correctly.
 */
function mount(body, boneName, offset) {
  const bone = body.getObjectByName(boneName);
  if (!bone) return null;
  body.updateWorldMatrix(true, false);
  bone.updateWorldMatrix(true, false);

  const rel = new THREE.Matrix4()
    .copy(body.matrixWorld).invert().multiply(bone.matrixWorld);
  const q = new THREE.Quaternion().setFromRotationMatrix(rel).invert();

  const g = new THREE.Group();
  g.quaternion.copy(q);
  g.position.copy(offset.clone().applyQuaternion(q));
  bone.add(g);
  return g;
}

/** Build the hard kit for an outfit and hang it on the bones. */
function addGear(body, o, out) {
  const add = (boneName, offset, geo, color, rough = 0.55, metal = 0.05) => {
    const g = mount(body, boneName, offset);
    if (!g) return null;
    const key = `${color}:${rough}:${metal}`;
    let m = MAT_CACHE.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color), roughness: rough, metalness: metal,
        envMapIntensity: 0.9,
      });
      if (HIDE) { m.normalMap = HIDE; m.normalScale = new THREE.Vector2(0.4, 0.4); }
      MAT_CACHE.set(key, m);
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    g.add(mesh);
    out.push(g);
    return g;
  };
  const V = (x, yy, z) => new THREE.Vector3(x, yy, z);

  /*
   * Offsets are measured off the rig, not eyeballed: the mounting bones sit on
   * the body's axis rather than its surface, and each one has a different
   * amount of anatomy to clear (10.8 cm at the sternum, 3.4 cm at the knee).
   * `tools/rig-info.mjs` prints them.
   */

  /*
   * Hair.
   *
   * A crowd of identically bald men is its own kind of comical, and the pack
   * ships hairstyles rigged to the head bone. They go on rigidly: hair does not
   * deform meaningfully at the distance this game is played at, and a rigid
   * child of a bone costs a fraction of a second skinned mesh per character.
   *
   * Skipped under a balaclava or a hood, which would otherwise have hair
   * growing through them.
   */
  if (HAIR_SOURCE && !o.balaclava && o.head !== 'hood') {
    /*
     * The battalion is on an operation and the crew is not, so they do not draw
     * from the same set: police get service cuts, and anything under a helmet
     * or a cap has to be a close crop or it grows through the crown.
     */
    const police = String(o.preset ?? '').startsWith('police');
    const capped = o.head === 'helmet' || o.head === 'cap';
    const styles = police ? HAIR_SOURCE.styles.slice(0, 2) : HAIR_SOURCE.styles;
    if (styles.length) {
      const pick = styles[Math.abs(o.hair ?? 0) % styles.length];
      const style = capped ? (HAIR_SOURCE.buzz ?? pick) : pick;
      if (style) {
        /*
         * These are the pack's "Origin at 0" hairstyles: their vertices are
         * measured from the character's origin, not from the head. Parenting
         * one straight to the head bone stacks 1.6 m on top of 1.7 m and puts
         * the hair in the air above the character, so the mount is offset back
         * down by exactly the head bone's rest height.
         */
        const g = mount(body, 'Head', V(0, -1.600, 0.017));
        if (g) {
          const h = style.clone(true);
          h.traverse((m) => {
            if (!m.isMesh) return;
            m.castShadow = true;
            m.frustumCulled = false;
            m.material = m.material.clone();
            m.material.color = new THREE.Color(o.hair ?? 0x1b1310);
            m.material.roughness = 0.86;
            m.material.metalness = 0;
          });
          g.add(h);
          out.push(g);
        }
      }
    }
    if (HAIR_SOURCE.beard && !police && (o.hair ?? 0) % 3 === 0 && !o.face) {
      const g = mount(body, 'Head', V(0, -1.600, 0.017));
      if (g) {
        const bd = HAIR_SOURCE.beard.clone(true);
        bd.traverse((m) => {
          if (!m.isMesh) return;
          m.castShadow = true;
          m.frustumCulled = false;
          m.material = m.material.clone();
          m.material.color = new THREE.Color(o.hair ?? 0x1b1310);
          m.material.roughness = 0.9;
          m.material.metalness = 0;
        });
        g.add(bd);
        out.push(g);
      }
    }
  }

  /* headgear */
  if (o.head === 'helmet') {
    add('Head', V(0, 0.100, 0.020), gearGeo('helmet', () => {
      const shell = new THREE.SphereGeometry(0.115, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58);
      shell.scale(1, 1.02, 1.08);
      const rim = new THREE.TorusGeometry(0.113, 0.012, 6, 22).rotateX(Math.PI / 2).translate(0, 0.004, 0);
      return mergeGeometries([shell, rim]);
    }), o.helmet ?? 0x1a2130, 0.45, 0.15);

    if (o.visor) {
      add('Head', V(0, 0.110, 0.017), gearGeo('visor', () => {
        const v = new THREE.SphereGeometry(0.118, 18, 10, Math.PI * 0.72, Math.PI * 0.56, Math.PI * 0.34, Math.PI * 0.34);
        return v.scale(1, 1, 1.12);
      }), 0x0d1014, 0.18, 0.4);
    }
    if (o.nvg) {
      add('Head', V(0, 0.180, 0.117), gearGeo('nvg', () => {
        const arm = box(0.03, 0.06, 0.03);
        const l = new THREE.CylinderGeometry(0.021, 0.024, 0.075, 10).rotateX(Math.PI / 2).translate(-0.026, -0.03, 0.03);
        const r = l.clone().translate(0.052, 0, 0);
        return mergeGeometries([arm, l, r]);
      }), 0x14171c, 0.4, 0.3);
    }
  } else if (o.head === 'cap') {
    add('Head', V(0, 0.105, 0.020), gearGeo('cap', () => {
      const dome = new THREE.SphereGeometry(0.104, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
      dome.scale(1, 0.82, 1.04);
      // the peak is a shallow slice of a disc, which curves the way a real one does
      const peak = new THREE.CylinderGeometry(0.145, 0.145, 0.012, 20, 1, false, -0.5, 1.0);
      peak.scale(1, 1, 0.72);
      peak.translate(0, -0.004, 0.052);
      return mergeGeometries([dome, peak]);
    }), o.capColor ?? 0x151c2b, 0.85, 0)
      ?.rotateY(o.capBack ? Math.PI : 0);
  }

  /* plate-carrier furniture */
  if (o.pouches) {
    const w = 0.072, gap = 0.078;
    const cols = Math.min(o.pouches, 4);
    for (let i = 0; i < cols; i++) {
      const x = (i - (cols - 1) / 2) * gap;
      add('spine_02', V(x, 0.00, 0.175), gearGeo('pouch', () => box(w, 0.105, 0.052)),
        o.vest ?? 0x11151f, 0.72, 0);
    }
  }
  if (o.radio) {
    add('clavicle_l', V(0.074, -0.035, 0.107), gearGeo('radio', () => {
      const b = box(0.048, 0.085, 0.032);
      const ant = new THREE.CylinderGeometry(0.004, 0.003, 0.11, 6).translate(0.014, 0.095, 0);
      return mergeGeometries([b, ant]);
    }), 0x15181d, 0.5, 0.1);
  }
  if (o.holster) {
    add('thigh_r', V(-0.091, -0.141, 0.036), gearGeo('holster', () => {
      const body_ = box(0.062, 0.135, 0.09);
      const strap = box(0.026, 0.10, 0.10).translate(0, 0.11, 0);
      return mergeGeometries([body_, strap]);
    }), 0x14161a, 0.6, 0);
  }
  if (o.knees) {
    for (const side of ['calf_l', 'calf_r']) {
      add(side, V(0, 0.058, 0.066), gearGeo('knee', () => {
        const k = new THREE.SphereGeometry(0.062, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
        return k.scale(1, 1.15, 0.62).rotateX(Math.PI / 2);
      }), 0x16191e, 0.6, 0);
    }
  }

  /*
   * Footwear.
   *
   * Built rather than cut, because a shoe's whole shape is the part a shrink
   * wrap cannot give you: a flat sole standing proud of the ground, a blunt toe
   * box, a heel. The foot bone barely moves relative to the leg, so a rigid
   * object on it holds up fine.
   */
  /*
   * Measured, not guessed. The foot runs from z −0.142 to +0.128 in rest space
   * while its bone sits at z −0.088 — the ankle, 5 cm behind the middle of the
   * foot and 21 cm behind the toe. A boot placed at the bone ends up behind the
   * foot with the toes sticking out of the front of it.
   */
  const boot = !!o.knees || o.shoes === 0x14161a;
  for (const [side, hand] of [['foot_l', 1], ['foot_r', -1]]) {
    add(side, V(0.0175 * hand, -0.096, 0.081), gearGeo(boot ? 'boot' : 'shoe', () => {
      const parts = [
        box(0.118, 0.030, 0.292).translate(0, 0.015, 0),          // sole
        box(0.108, 0.080, 0.250).translate(0, 0.068, -0.014),     // upper
        box(0.096, 0.054, 0.086).translate(0, 0.046, 0.104),      // toe box
      ];
      if (boot) parts.push(box(0.104, 0.155, 0.112).translate(0, 0.180, -0.070));
      return mergeGeometries(parts);
    }), o.shoes ?? 0x22252b, boot ? 0.55 : 0.62, 0);
  }

  /* crew kit */
  if (o.chain) {
    add('spine_03', V(0, 0.130, 0.093), gearGeo('chain', () => {
      /*
       * Drawn as a hoop of small links rather than one torus. A torus wide
       * enough to clear the neck sits *inside* the chest at the collarbone,
       * because the neck and the chest are not the same radius.
       */
      const parts = [];
      const links = 26;
      for (let i = 0; i < links; i++) {
        const t = (i / (links - 1)) * Math.PI * 1.15 - Math.PI * 0.575;
        const r = 0.062;
        const bx = Math.sin(t) * r;
        const by = -Math.abs(Math.cos(t)) * 0.028 - Math.pow(Math.abs(Math.sin(t)), 2.2) * 0.055;
        const bz = Math.cos(t) * 0.028;
        parts.push(new THREE.SphereGeometry(0.0075, 6, 5).translate(bx, by, bz));
      }
      return mergeGeometries(parts);
    }), 0xd9a441, 0.25, 0.95);
  }
  if (o.hip) {
    add('pelvis', V(0.02, 0.031, 0.167), gearGeo('bumbag', () => {
      const b = box(0.17, 0.085, 0.06);
      b.scale(1, 1, 1);
      return b;
    }), o.hip, 0.7, 0);
  }
  if (o.wrist) {
    add('lowerarm_l', V(0.20, 0, 0), gearGeo('wrist', () =>
      new THREE.TorusGeometry(0.032, 0.008, 6, 14).rotateY(Math.PI / 2)),
    o.wrist, 0.8, 0);
  }
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * Dress a cloned body.
 *
 * @param {THREE.Object3D} body   a SkeletonUtils clone of the pack body
 * @param {object} outfit         the same record the procedural rig takes
 * @returns {THREE.Object3D[]}    everything added, for disposal
 */
export function dress(body, outfit) {
  const src = bodyMesh(body);
  if (!src) return [];

  const added = [];
  const kit = buildKit(src, outfit);

  for (const kind of ['cloth', 'gear']) {
    const geo = kit[kind];
    if (!geo) continue;
    const mesh = new THREE.SkinnedMesh(geo, material(kind));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    src.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    src.parent.add(mesh);
    mesh.bind(src.skeleton, src.bindMatrix);
    added.push(mesh);
  }

  addGear(body, outfit, added);
  return added;
}

/** The skin mesh, as opposed to the eyes and eyebrows that ship with it. */
function bodyMesh(root) {
  const skins = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  return skins.find((s) => (s.material?.name ?? '').includes('Superhero')) ?? skins[0] ?? null;
}

/**
 * Every garment for a preset, merged by material and cached.
 *
 * The cut is the expensive part — it walks 12,500 triangles per garment — and
 * it produces exactly the same result for every character wearing the preset,
 * so it happens once for the whole crowd.
 */
function buildKit(src, outfit) {
  const key = outfit.preset ?? JSON.stringify(outfit);
  const hit = KIT_CACHE.get(key);
  if (hit) return hit;

  src.updateWorldMatrix(true, false);
  const toRest = restMatrix(src);
  const toAttr = toRest.clone().invert();

  const pos = src.geometry.attributes.position;
  const rest = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toRest);
    rest[i * 3] = v.x; rest[i * 3 + 1] = v.y; rest[i * 3 + 2] = v.z;
  }

  const piles = { cloth: [], gear: [] };
  const stats = [];
  for (const spec of garments(outfit)) {
    const g = cutGarment(src, spec, rest, toAttr);
    stats.push({ name: spec.name, tris: g ? g.index.count / 3 : 0 });
    if (g) piles[spec.kind].push(g);
  }

  const out = {
    cloth: piles.cloth.length ? mergeGeometries(piles.cloth) : null,
    gear: piles.gear.length ? mergeGeometries(piles.gear) : null,
    stats,
  };
  KIT_CACHE.set(key, out);
  return out;
}
