import * as THREE from 'three';
import { makeRNG, clamp, damp, lerp, angleDelta } from '../core/utils.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  CHARACTER RIG — smooth procedural humanoid
 * ══════════════════════════════════════════════════════════════════
 *
 * Bodies are built from capsules, spheres and a lathed torso rather than
 * boxes, so they read as people instead of stacked crates.
 *
 * Two things keep that cheap:
 *
 *  1. **Vertex colours.** Skin, shirt, trousers and kit all live in one
 *     buffer under a single shared material, so a whole limb — including its
 *     sleeve, glove and any strapping — is one draw call instead of four.
 *  2. **Geometry caching.** Outfits come from a small preset table, so the
 *     merged buffers for "crew grunt #3" are built once and shared by every
 *     character wearing it. Spawning a new agent allocates nothing but a
 *     handful of Object3Ds.
 *
 * Local Y is measured from the feet; total height ≈ 1.84 m.
 */

/* ── detail level (dropped on low-end / mobile before any character is built) ─ */
let DETAIL = 1;
export function setCharacterDetail(level) {
  if (level === DETAIL) return;
  DETAIL = level;
  GEO_CACHE.clear();
  PART_CACHE.clear();
}
const seg = (hi, lo) => (DETAIL >= 1 ? hi : lo);

/* ── primitive cache ──────────────────────────────────────────────── */
const GEO_CACHE = new Map();
function prim(key, make) {
  let g = GEO_CACHE.get(key);
  if (!g) GEO_CACHE.set(key, (g = make()));
  return g;
}

const capsule = (r, len) =>
  prim(`c${r}|${len}|${DETAIL}`, () =>
    new THREE.CapsuleGeometry(r, len, seg(4, 2), seg(12, 6)));

const ball = (r) =>
  prim(`s${r}|${DETAIL}`, () =>
    new THREE.SphereGeometry(r, seg(14, 7), seg(10, 5)));

/** Hemisphere cap - hair, caps, helmets. */
const dome = (r) =>
  prim(`d${r}|${DETAIL}`, () =>
    new THREE.SphereGeometry(r, seg(14, 7), seg(8, 4), 0, Math.PI * 2, 0, Math.PI * 0.55));

const tube = (r, h) =>
  prim(`t${r}|${h}|${DETAIL}`, () =>
    new THREE.CylinderGeometry(r, r, h, seg(12, 6), 1));

/** Flat kit: armour plates, pouches, radios, patches, sandal soles. */
const slab = (w, h, d) => prim(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));

/** A ring — neck chains, helmet rails, wristbands. */
const ring = (r, t) =>
  prim(`o${r}|${t}|${DETAIL}`, () => new THREE.TorusGeometry(r, t, seg(6, 4), seg(16, 8)));

/** Torso: a lathed silhouette, flattened front-to-back so it isn't a barrel. */
const torsoGeo = (broad) =>
  prim(`torso${broad}|${DETAIL}`, () => {
    const w = broad ? 1.16 : 1.0;
    const pts = [
      [0.020, 0.000], [0.130, 0.005], [0.148, 0.070], [0.162, 0.170],
      [0.178, 0.280], [0.192, 0.390], [0.196, 0.470], [0.186, 0.540],
      [0.150, 0.592], [0.070, 0.615], [0.020, 0.620],
    ].map(([r, y]) => new THREE.Vector2(r * w, y));
    const g = new THREE.LatheGeometry(pts, seg(16, 8));
    g.scale(1, 1, 0.72);
    g.computeVertexNormals();
    return g;
  });

/* ── merged, vertex-coloured parts ────────────────────────────────── */
export class PartMesh {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; }

  /** @param {THREE.BufferGeometry} geo @param {THREE.Matrix4} m @param {number} hex */
  add(geo, m, hex) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const uv = g.attributes.uv?.array;
    const nm = _nm.getNormalMatrix(m);
    _c.setHex(hex, THREE.SRGBColorSpace);

    /*
     * UVs get rescaled into world units, for the same reason the level's boxes
     * do. Every primitive here — capsule, sphere, lathe — has UVs running 0..1
     * whatever its size, so a shared fabric texture would come out at a
     * different weave density on a forearm than on a torso. Approximating u as
     * the transformed circumference and v as the transformed height puts every
     * part on the same scale, and the material's repeat then sets the weave.
     */
    g.computeBoundingBox();
    const bb = g.boundingBox;
    _v.subVectors(bb.max, bb.min);
    const sx = m.elements[0], sy = m.elements[5], sz = m.elements[10];
    const su = Math.PI * (Math.abs(_v.x * sx) + Math.abs(_v.z * sz)) / 2;
    const sv = Math.abs(_v.y * sy);

    for (let i = 0, k = 0; i < p.length; i += 3, k += 2) {
      _v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r, _c.g, _c.b);
      this.uv.push(uv ? uv[k] * su : 0, uv ? uv[k + 1] * sv : 0);
    }
  }

  get empty() { return this.pos.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Placement helper: position + uniform-ish scale + rotation, in one call. */
function at(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, 0, rz);
  return _m.compose(_v2.set(x, y, z), _q.setFromEuler(_e), _v3.set(sx, sy, sz));
}

/**
 * One material for every body on screen. Roughness is set for cloth and skin;
 * weapons get their own metallic material so guns don't read as fabric.
 */
export const BODY_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.78, metalness: 0.02, envMapIntensity: 0.55,
});
export const GEAR_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.38, metalness: 0.82, envMapIntensity: 1.0,
});

/**
 * Give the bodies real cloth and leather microsurface.
 *
 * This rig is the fallback now — `entities/actor.js` puts a real rigged human
 * on screen whenever the CC0 character pack is present, and this one stands in
 * when it is not. It is still worth shading properly for exactly that case: a
 * measured woven-cotton normal on the bodies and a leather grain on the gear.
 *
 * Only the normal and roughness are taken. Colour stays with the per-outfit
 * vertex tint, because the whole roster's identity is in those palettes and a
 * scanned albedo would flatten ten distinct operators into one grey crowd.
 *
 * The maps land on skin and hair as well as clothing — one merged mesh per
 * character is what keeps the crowd affordable, and splitting it in two to
 * mask a sub-millimetre normal perturbation on a 12 cm head would double the
 * draw calls for something invisible at gameplay distance. `normalScale` is
 * kept low for the same reason: this is meant to stop fabric reading as
 * painted plastic, not to make anyone look knitted.
 */
export function applyCharacterMaterials(assets) {
  if (!assets?.ready) return false;
  const cloth = assets.material('cloth');
  const leather = assets.material('leather');

  const wrap = (t, repeat) => {
    if (!t) return null;
    const c = t.clone();
    c.needsUpdate = true;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(repeat, repeat);
    return c;
  };

  if (cloth?.normal) {
    BODY_MATERIAL.normalMap = wrap(cloth.normal, 4);
    BODY_MATERIAL.normalScale = new THREE.Vector2(0.35, 0.35);
    BODY_MATERIAL.needsUpdate = true;
  }
  if (leather?.normal) {
    GEAR_MATERIAL.normalMap = wrap(leather.normal, 6);
    GEAR_MATERIAL.normalScale = new THREE.Vector2(0.5, 0.5);
    GEAR_MATERIAL.needsUpdate = true;
  }
  // a real environment lights these properly now; the old values were dialled
  // down to compensate for the analytic sky being too dim to flatter anything
  BODY_MATERIAL.envMapIntensity = 0.9;
  GEAR_MATERIAL.envMapIntensity = 1.2;
  return true;
}

/* ── outfits ──────────────────────────────────────────────────────────
 * A small preset table rather than free randomisation: the crew reads as a
 * crew, the battalion reads as a unit, and every preset's merged geometry
 * gets built once and shared.
 * ─────────────────────────────────────────────────────────────────── */
const SKINS = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x6b4423, 0xa1665e];
const HAIR = [0x1b1310, 0x2e2119, 0x4a3020, 0x14100e, 0x5a4632];

/*
 * ── the crew ──
 * The look is Rio hillside street wear, not "generic thug": football shirts
 * and tank tops, board shorts, flip-flops, a cap worn backwards, a gold chain,
 * a bum bag slung across the chest. The details are what make a crowd of them
 * read as people who live here rather than as respawning enemies, so each
 * preset picks a different combination rather than recolouring one outfit.
 */
const CREW_PRESETS = [
  { shirt: 0xf2f2f2, pants: 0x2b3a55, head: 'cap', capColor: 0xe11d48, capBack: true,
    tank: true, chain: true, trim: 0xe11d48 },
  { shirt: 0xffd23f, pants: 0x3a3a3a, head: 'bandana', bandana: 0xe11d48,
    shorts: true, trim: 0x1f6f3f, sandals: true, wrist: 0xe11d48 },
  { shirt: 0x2fb0a0, pants: 0x1f2937, head: 'none', tank: true, shorts: true,
    chain: true, sandals: true },
  { shirt: 0xe94f37, pants: 0x6b5b3e, head: 'cap', capColor: 0x111111,
    hip: 0x14161a, trim: 0xf2f2f2 },
  { shirt: 0x111111, pants: 0x2b3a55, head: 'bandana', bandana: 0xffd23f,
    face: 0xffd23f, chain: true, hip: 0x2b3a55 },
  { shirt: 0x4f9d4f, pants: 0x8b8378, head: 'none', shorts: true,
    trim: 0xffd23f, sandals: true },
  { shirt: 0xff7a2f, pants: 0x1f2937, head: 'cap', capColor: 0xf2f2f2, capBack: true,
    tank: true, chain: true, wrist: 0xf2f2f2 },
  { shirt: 0x7f6fd4, pants: 0x3a3a3a, head: 'hood', hood: 0x3a3a3a, face: 0x1b1d20,
    hip: 0x14161a },
];

/*
 * ── the battalion ──
 * Brazilian military police on an operation: navy or grey fatigues under a
 * plate carrier with magazine pouches across the front, a shoulder radio,
 * gloves, knee pads and a drop-leg holster. The reflective POLICE band across
 * the back is the single most legible identifier at range and the reason a
 * player can tell sides apart in a firefight without a nameplate.
 */
const COP_PRESETS = [
  { shirt: 0x1d2a44, pants: 0x151c2b, head: 'helmet', helmet: 0x1a2130, vest: 0x11151f,
    pouches: 3, radio: true, holster: true, knees: true, gloves: 0x14161a, patch: 0xdfe6ef },
  { shirt: 0x23303f, pants: 0x151c2b, head: 'cap', capColor: 0x151c2b, vest: 0x11151f,
    pouches: 2, radio: true, holster: true, gloves: 0x14161a, patch: 0xdfe6ef },
  { shirt: 0x1d2a44, pants: 0x151c2b, head: 'helmet', helmet: 0x151c2b, vest: 0x0f1219,
    pouches: 3, radio: true, holster: true, knees: true, gloves: 0x14161a, patch: 0xdfe6ef },
  { shirt: 0x22303c, pants: 0x171d29, head: 'none', vest: 0x11151f,
    pouches: 2, holster: true, gloves: 0x14161a, patch: 0xdfe6ef },
];

/*
 * ── the battalion's assault element ──
 * All black, balaclava under the helmet, full plate carrier with side plates,
 * and a visor. No reflective band: this lot are not trying to be seen.
 */
const ELITE_PRESETS = [
  { shirt: 0x0e0f12, pants: 0x0e0f12, head: 'helmet', helmet: 0x0a0b0d, vest: 0x0a0b0d,
    visor: true, balaclava: 0x0a0b0d, pouches: 4, radio: true, holster: true,
    knees: true, gloves: 0x0a0b0d, sidePlates: true, nvg: true },
  { shirt: 0x14161a, pants: 0x0e0f12, head: 'helmet', helmet: 0x101216, vest: 0x0a0b0d,
    visor: true, balaclava: 0x101216, pouches: 4, radio: true, holster: true,
    knees: true, gloves: 0x0a0b0d, sidePlates: true },
];

export function makeOutfit(faction, rank, rng = makeRNG((Math.random() * 1e9) | 0)) {
  const table = faction === 'police'
    ? (rank === 'elite' ? ELITE_PRESETS : COP_PRESETS)
    : CREW_PRESETS;
  const pi = rng.int(0, table.length - 1);
  const si = rng.int(0, SKINS.length - 1);
  const hi = rng.int(0, HAIR.length - 1);

  return {
    ...table[pi],
    preset: `${faction}:${rank}:${pi}:${si}:${hi}`,
    skin: SKINS[si],
    hair: HAIR[hi],
    shoes: faction === 'police' ? 0x14161a : (pi % 2 ? 0xf2f2f2 : 0x22252b),
    hasVest: !!table[pi].vest,
    strap: 0x1b1d20,
    frame: 'normal',
    /*
     * Which body the skinned actor should wear.
     *
     * Both factions are now supplied, finished figures — the police in riot
     * gear, the crew in a Flamengo shirt and shorts — so both skip the
     * cut-from-the-body clothing the rest of this file builds, and both skip
     * the skin tint, which would recolour a plate carrier or a football shirt
     * as though it were forearm.
     *
     * The cost is that the crew are now one man five times over, where the cut
     * clothing gave five different outfits out of one mesh. That is the trade
     * the supplied model makes: a much better-looking gangster, and only one of
     * him. The procedural path is still here and still works, so the fallback
     * when the pack is missing is the varied one.
     */
    body: faction === 'police' ? 'armored' : 'crew',
  };
}

/* ── the rig ──────────────────────────────────────────────────────── */
const PART_CACHE = new Map();

/** Build (or fetch) the merged geometry for every pivot of an outfit. */
function buildParts(o) {
  const key = o.preset + '|' + o.frame + '|' + DETAIL;
  const hit = PART_CACHE.get(key);
  if (hit) return hit;

  const broad = o.frame === 'heavy';
  const armR = broad ? 0.062 : 0.055;
  const legR = broad ? 0.104 : 0.095;

  const P = {
    pelvis: new PartMesh(), chest: new PartMesh(), head: new PartMesh(),
    thighL: new PartMesh(), thighR: new PartMesh(),
    shinL: new PartMesh(), shinR: new PartMesh(),
    upperL: new PartMesh(), upperR: new PartMesh(),
    foreL: new PartMesh(), foreR: new PartMesh(),
    handL: new PartMesh(), handR: new PartMesh(),
  };

  const skin = o.skin;
  const sleeveless = !!o.tank;

  // ── pelvis ──
  P.pelvis.add(ball(0.152), at(0, -0.02, 0, 1.06, 0.84, 0.86), o.pants);

  // ── torso ──
  // The shirt is always the outer surface. A tank top is expressed by leaving
  // the shoulders and arms bare, never by a second body poking through the
  // first - two nested lathes at similar radii z-fight into a stripe.
  P.chest.add(torsoGeo(broad), at(0, 0, 0), o.shirt);
  if (sleeveless) {
    P.chest.add(ball(0.088), at(-0.176, 0.505, 0, 1, 0.92, 1), skin);
    P.chest.add(ball(0.088), at(0.176, 0.505, 0, 1, 0.92, 1), skin);
  }
  /*
   * ── plate carrier ──
   * A vest is not a recoloured torso. What makes body armour read as armour is
   * that it is a separate rigid object hung on the body: hard plates front and
   * back with a gap at the sides, a cummerbund wrapping the ribs, straps over
   * the shoulders, and pouches standing proud of the chest. Every one of those
   * is a silhouette change, which is what survives being seen at forty metres.
   */
  if (o.vest) {
    const cw = broad ? 1.09 : 1.0;
    // front and back plates, flat and slightly proud of the chest
    P.chest.add(slab(0.29 * cw, 0.34, 0.055), at(0, 0.315, 0.105), o.vest);
    P.chest.add(slab(0.29 * cw, 0.34, 0.05), at(0, 0.315, -0.108), o.vest);
    // cummerbund joining them round the ribs
    P.chest.add(torsoGeo(broad), at(0, 0.055, 0, 1.055, 0.42, 1.14), o.vest);
    // shoulder straps
    for (const side of [-1, 1]) {
      P.chest.add(slab(0.075, 0.055, 0.235), at(side * 0.115, 0.505, 0), o.vest);
      P.chest.add(ball(0.086), at(side * 0.183, 0.522, 0, 1.0, 0.92, 1.0), o.vest);
    }
    if (o.sidePlates) {
      for (const side of [-1, 1]) {
        P.chest.add(slab(0.045, 0.20, 0.20), at(side * 0.205, 0.24, 0), o.vest);
      }
    }

    // magazine pouches across the front, stacked left to right
    const n = o.pouches | 0;
    for (let i = 0; i < n; i++) {
      const span = 0.078;
      const px = (i - (n - 1) / 2) * span;
      P.chest.add(slab(0.068, 0.135, 0.062), at(px, 0.225, 0.155), 0x14171c);
      P.chest.add(slab(0.070, 0.022, 0.028), at(px, 0.292, 0.168), o.vest);   // flap
    }

    // shoulder radio with a stub antenna, worn on the left
    if (o.radio) {
      P.chest.add(slab(0.052, 0.105, 0.042), at(-0.155, 0.415, 0.095), 0x1a1e24);
      P.chest.add(tube(0.006, 0.12), at(-0.155, 0.515, 0.095), 0x0c0d10);
    }

    /*
     * The reflective POLICE band across the back. This is the single most
     * useful piece of readability in the whole game: in a firefight on a dark
     * staircase it is often the only thing distinguishing a silhouette that
     * should be shot from one that should not.
     */
    if (o.patch) {
      P.chest.add(slab(0.20, 0.052, 0.012), at(0, 0.335, -0.136), o.patch);
      P.chest.add(slab(0.075, 0.03, 0.012), at(-0.085, 0.44, 0.136), o.patch);
    }
  }

  /*
   * ── the crew's kit ──
   * Small, cheap, and the whole difference between "person in a coloured
   * shirt" and "someone from this hillside".
   */
  if (o.trim) {                       // football-shirt collar, hoop and cuffs
    P.chest.add(tube(0.079, 0.022), at(0, 0.601, 0), o.trim);
    /*
     * A hoop has to be a ring, not a squashed copy of the torso: scaling the
     * lathe down in Y moves every row toward the waist but keeps its radius,
     * so it comes out as a cone and reads as a wide red cummerbund. A torus
     * flattened to the torso's own ellipse sits where a shirt stripe sits.
     */
    P.chest.add(ring(0.183 * (broad ? 1.16 : 1.0), 0.026),
      at(0, 0.335, 0, 1, 1, 0.74, Math.PI / 2), o.trim);
    if (!sleeveless) {
      for (const side of [-1, 1]) P.chest.add(ball(0.0895), at(side * 0.176, 0.475, 0, 1, 0.34, 1), o.trim);
    }
  }
  if (o.chain) {
    /*
     * A torus at the neck disappears inside the torso — the lathe is already
     * 0.19 m across at the collarbone. A chain has to be drawn as what it is:
     * links following the outside of the chest, dipping to the sternum.
     */
    const N = 9;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const a = (t - 0.5) * Math.PI * 0.92;
      const dip = Math.cos(a);
      P.chest.add(ball(0.0125), at(
        Math.sin(a) * 0.135, 0.545 - dip * 0.105, 0.108 + dip * 0.022), 0xd8b23c);
    }
  }
  if (o.hip) {                        // bum bag slung across the chest
    P.chest.add(slab(0.145, 0.085, 0.06), at(0.055, 0.235, 0.135), o.hip);
    P.chest.add(slab(0.035, 0.40, 0.02), at(-0.02, 0.40, 0.128, 1, 1, 1, 0, 0.62), o.hip);
  }
  // neck + collar
  P.chest.add(tube(0.075, 0.055), at(0, 0.598, 0), o.shirt);
  P.chest.add(capsule(0.054, 0.06), at(0, 0.645, 0), skin);

  // ── head (pivots at the neck) ──
  P.head.add(capsule(0.052, 0.05), at(0, 0.03, 0), skin);
  P.head.add(ball(0.115), at(0, 0.16, 0, 1.0, 1.13, 1.04), skin);
  /*
   * A face. Two dots for eyes is enough to tell which way someone is looking
   * from thirty metres, but the camera in a third-person shooter spends a lot
   * of time about a metre behind the player's head, and at that range a blank
   * ovoid is the most obviously synthetic thing on screen. A brow ridge, a
   * nose and a mouth line cost eight primitives and carry the whole read.
   */
  P.head.add(ball(0.0155), at(-0.043, 0.168, 0.101), 0x1a1108);
  P.head.add(ball(0.0155), at(0.043, 0.168, 0.101), 0x1a1108);
  for (const side of [-1, 1]) {
    P.head.add(slab(0.040, 0.010, 0.014), at(side * 0.045, 0.191, 0.100), o.hair);   // eyebrow
    P.head.add(ball(0.030), at(side * 0.070, 0.155, 0.058, 1.0, 1.5, 1.0), skin);    // cheekbone
  }
  P.head.add(ball(0.020), at(0, 0.150, 0.104, 0.75, 1.35, 1.05), skin);              // nose
  P.head.add(slab(0.040, 0.007, 0.012), at(0, 0.112, 0.100), 0x6b3f38);              // mouth
  P.head.add(ball(0.055), at(0, 0.075, 0.052, 1.35, 1.0, 1.0), skin);                // jaw

  // a balaclava goes on before anything else, so the helmet sits over it
  if (o.balaclava) {
    P.head.add(ball(0.119), at(0, 0.16, 0, 1.0, 1.13, 1.04), o.balaclava);
    P.head.add(capsule(0.056, 0.05), at(0, 0.03, 0), o.balaclava);
    // eye slit, so the face is not a featureless egg
    P.head.add(slab(0.135, 0.030, 0.03), at(0, 0.172, 0.100), 0x08090b);
  } else if (o.face) {
    // bandana pulled up over the nose
    P.head.add(ball(0.117), at(0, 0.128, 0.012, 1.02, 0.62, 1.04), o.face);
  }

  if (o.head === 'helmet') {
    /*
     * A ballistic helmet, not a bowl. The shell, the cut-away ear cups, the
     * accessory rails down each side and the shroud on the front are what make
     * the silhouette read as modern kit rather than as a motorcycle helmet —
     * and the shape above the shoulders is most of what identifies a police
     * unit at the far end of a street.
     */
    P.head.add(dome(0.134), at(0, 0.132, 0, 1.0, 1.06, 1.08), o.helmet);
    P.head.add(tube(0.135, 0.042), at(0, 0.140, 0), o.helmet);
    P.head.add(ball(0.058), at(0, 0.142, 0.118, 1.95, 0.30, 1.0), o.helmet);   // brow
    for (const side of [-1, 1]) {
      P.head.add(ball(0.062), at(side * 0.122, 0.108, 0.006, 0.55, 1.05, 1.25), o.helmet); // ear cup
      P.head.add(slab(0.014, 0.020, 0.145), at(side * 0.132, 0.168, 0.0), 0x0b0c0e);        // rail
    }
    P.head.add(slab(0.052, 0.030, 0.030), at(0, 0.196, 0.118), 0x0b0c0e);       // NVG shroud
    if (o.nvg) {
      P.head.add(slab(0.030, 0.052, 0.036), at(0, 0.246, 0.128), 0x15181d);     // stowed mount
      P.head.add(tube(0.019, 0.062), at(0, 0.258, 0.150, 1, 1, 1, Math.PI / 2), 0x0e1013);
    }
    // chin strap
    for (const side of [-1, 1]) {
      P.head.add(slab(0.012, 0.105, 0.014), at(side * 0.104, 0.055, 0.030), 0x1b1e23);
    }
    if (o.visor) P.head.add(ball(0.110), at(0, 0.152, 0.040, 1.04, 0.74, 1.14), 0x23303d);
  } else if (o.head === 'cap') {
    // the peak flips to the back when the cap is worn backwards
    const peak = o.capBack ? -1 : 1;
    P.head.add(dome(0.124), at(0, 0.15, 0, 1.0, 0.95, 1.02), o.capColor);
    P.head.add(ball(0.06), at(0, 0.152, peak * 0.115, 1.7, 0.2, 1.25), o.capColor);
    if (o.capBack) P.head.add(slab(0.052, 0.026, 0.014), at(0, 0.150, 0.118), 0x0e0f11); // strap
    P.head.add(dome(0.118), at(0, 0.12, -0.01, 1, 0.75, 1), o.hair);
  } else if (o.head === 'bandana') {
    P.head.add(dome(0.121), at(0, 0.14, 0, 1.0, 0.72, 1.02), o.bandana);
    P.head.add(ball(0.032), at(0, 0.15, -0.11, 1, 0.7, 1.6), o.bandana);      // knot
  } else if (o.head === 'hood') {
    P.head.add(ball(0.138), at(0, 0.152, -0.012, 1.02, 1.06, 1.06), o.hood);
    P.head.add(tube(0.126, 0.05), at(0, 0.062, -0.02), o.hood);              // cowl on the shoulders
    P.head.add(ball(0.104), at(0, 0.166, 0.086, 1.0, 0.94, 0.7), 0x0a0b0d);  // shadowed opening
  } else if (!o.balaclava) {
    P.head.add(dome(0.121), at(0, 0.135, -0.005, 1.0, 0.86, 1.02), o.hair);
  }

  // ── limbs ──
  for (const side of [-1, 1]) {
    const L = side < 0 ? 'L' : 'R';
    const legLower = o.shorts ? skin : o.pants;
    const armUpper = sleeveless ? skin : o.shirt;

    // thigh: pivot at the hip, capsule hanging below, with a joint ball so
    // the limb reads as attached rather than floating under the pelvis
    P['thigh' + L].add(ball(legR * 1.06), at(0, -0.015, 0), o.pants);
    P['thigh' + L].add(capsule(legR, 0.28), at(0, -0.225, 0), o.pants);
    // board shorts hang loose and end in a visible hem, which is what stops
    // "shorts" reading as trousers that forgot to render below the knee
    if (o.shorts) {
      P['thigh' + L].add(capsule(legR * 1.16, 0.10), at(0, -0.300, 0), o.pants);
      P['thigh' + L].add(tube(legR * 1.20, 0.022), at(0, -0.352, 0), o.trim ?? o.pants);
    }
    // shin
    P['shin' + L].add(ball(legR * 0.86), at(0, 0.005, 0), legLower);
    P['shin' + L].add(capsule(legR * 0.78, 0.235), at(0, -0.19, 0), legLower);
    P['shin' + L].add(ball(0.066), at(0, -0.335, 0), o.sandals ? skin : legLower);   // ankle

    if (o.sandals) {
      // flip-flops: a thin sole and a toe strap, with the foot bare above it
      P['shin' + L].add(ball(0.062), at(0, -0.372, 0.045, 1.10, 0.52, 1.95), skin);
      P['shin' + L].add(slab(0.088, 0.018, 0.235), at(0, -0.398, 0.048), o.shoes);
      P['shin' + L].add(slab(0.014, 0.030, 0.075), at(0, -0.372, 0.098), o.strap);
    } else {
      P['shin' + L].add(ball(0.072), at(0, -0.375, 0.05, 1.12, 0.66, 2.05), o.shoes);
      // a sole in a contrasting tone: a boot without one is a lump
      P['shin' + L].add(slab(0.098, 0.026, 0.225), at(0, -0.400, 0.052), 0x14161a);
    }

    // knee pads sit on the shin's upper end, where the joint actually is
    if (o.knees) {
      P['shin' + L].add(ball(legR * 1.05), at(0, -0.010, 0.030, 1.05, 1.15, 1.15), 0x14171c);
    }

    P['upper' + L].add(ball(armR * 1.25), at(0, -0.005, 0), armUpper);
    P['upper' + L].add(capsule(armR, 0.19), at(0, -0.155, 0), armUpper);
    P['fore' + L].add(ball(armR * 0.98), at(0, 0.005, 0), skin);
    P['fore' + L].add(capsule(armR * 0.88, 0.175), at(0, -0.145, 0), skin);
    if (o.wrist) P['fore' + L].add(tube(armR * 0.94, 0.028), at(0, -0.232, 0), o.wrist);

    /*
     * Hands. A sphere reads as a mitten, and the hands are right next to the
     * weapon so they are looked at more than any other part of the body. A
     * flattened palm with a thumb block is barely more geometry and reads as
     * a hand gripping something.
     */
    const glove = o.gloves ?? skin;
    P['hand' + L].add(ball(0.055), at(0, -0.030, 0.004, 1.0, 1.35, 0.80), glove);
    P['hand' + L].add(slab(0.030, 0.052, 0.052), at(side * 0.030, -0.022, 0.012), glove);
    if (o.gloves) P['hand' + L].add(tube(armR * 0.96, 0.036), at(0, 0.014, 0), o.gloves); // cuff
  }

  // drop-leg holster with a pistol butt showing, on the strong side
  if (o.holster) {
    P.thighR.add(slab(0.062, 0.135, 0.085), at(0.088, -0.235, 0.010), 0x14171c);
    P.thighR.add(slab(0.026, 0.052, 0.060), at(0.088, -0.150, 0.014), 0x2b2f36);
    P.thighR.add(slab(0.048, 0.020, 0.020), at(0.088, -0.110, 0.006), 0x1b1e23);
  }

  const out = {};
  for (const k of Object.keys(P)) out[k] = P[k].empty ? null : P[k].build();
  PART_CACHE.set(key, out);
  return out;
}

export class CharacterModel {
  constructor(outfit) {
    this.o = outfit;
    this.root = new THREE.Group();
    this.phase = Math.random() * Math.PI * 2;
    this.aimBlend = 0;
    this.crouchBlend = 0;
    this.deadBlend = 0;
    this._baseY = 0;
    this._build();
  }

  _build() {
    const parts = buildParts(this.o);
    const mesh = (geo) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, BODY_MATERIAL);
      m.castShadow = true;
      return m;
    };
    const attach = (parent, geo) => {
      const m = mesh(geo);
      if (m) parent.add(m);
      return m;
    };

    // ── pelvis ──
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 0.92;
    this.root.add(this.pelvis);
    attach(this.pelvis, parts.pelvis);

    // ── legs ──
    this.legs = [];
    for (const side of [-1, 1]) {
      const L = side < 0 ? 'L' : 'R';
      const hip = new THREE.Group();
      hip.position.set(side * 0.098, 0.90, 0);
      this.root.add(hip);
      attach(hip, parts['thigh' + L]);

      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      attach(knee, parts['shin' + L]);

      this.legs.push({ hip, knee, side });
    }

    // ── torso ──
    this.chest = new THREE.Group();
    this.chest.position.y = 0.92;
    this.root.add(this.chest);
    attach(this.chest, parts.chest);

    this.neck = new THREE.Group();
    this.neck.position.y = 0.62;
    this.chest.add(this.neck);
    attach(this.neck, parts.head);

    // ── arms ──
    this.arms = [];
    for (const side of [-1, 1]) {
      const L = side < 0 ? 'L' : 'R';
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.192, 0.545, 0);
      this.chest.add(shoulder);
      attach(shoulder, parts['upper' + L]);

      const elbow = new THREE.Group();
      elbow.position.y = -0.295;
      shoulder.add(elbow);
      attach(elbow, parts['fore' + L]);

      const hand = new THREE.Group();
      hand.position.y = -0.275;
      elbow.add(hand);
      attach(hand, parts['hand' + L]);

      this.arms.push({ shoulder, elbow, hand, side });
    }
    this.leftHand = this.arms[0].hand;
    this.rightHand = this.arms[1].hand;
  }

  /**
   * @param {object} s speed · aiming · crouching · pitch · dead · lean
   */
  update(dt, s) {
    this.aimBlend = damp(this.aimBlend, s.aiming ? 1 : 0, 14, dt);
    this.crouchBlend = damp(this.crouchBlend, s.crouching ? 1 : 0, 12, dt);
    this.deadBlend = damp(this.deadBlend, s.dead ? 1 : 0, s.dead ? 7 : 20, dt);

    const speed = s.speed || 0;
    const moving = speed > 0.25;
    const stride = clamp(speed / 5.2, 0, 1.35);
    this.phase += dt * (2.6 + speed * 1.55);
    const sw = Math.sin(this.phase);
    const sw2 = Math.sin(this.phase * 2);

    // ── legs ──
    const amp = moving ? 0.55 * stride + 0.1 : 0;
    for (const leg of this.legs) {
      const d = leg.side < 0 ? 1 : -1;
      leg.hip.rotation.x = damp(leg.hip.rotation.x,
        amp * sw * d - this.crouchBlend * 0.8, 18, dt);
      const bend = moving ? Math.max(0, -sw * d) * amp * 1.5 + 0.06 : 0.04;
      leg.knee.rotation.x = damp(leg.knee.rotation.x, bend + this.crouchBlend * 1.4, 18, dt);
      leg.hip.position.y = 0.90 - this.crouchBlend * 0.3;
    }

    // ── torso ──
    const bob = moving ? Math.abs(sw2) * 0.032 * stride : Math.sin(this.phase * 0.6) * 0.008;
    this.chest.position.y = 0.92 + bob - this.crouchBlend * 0.34;
    this.pelvis.position.y = 0.92 + bob * 0.5 - this.crouchBlend * 0.34;

    const pitch = clamp(s.pitch || 0, -0.9, 0.9);
    this.chest.rotation.x = damp(this.chest.rotation.x,
      -pitch * 0.32 + (moving ? 0.08 * stride : 0) + this.crouchBlend * 0.18, 12, dt);
    this.chest.rotation.z = damp(this.chest.rotation.z, -(s.lean || 0) * 0.11, 8, dt);
    // counter-rotate the hips a little - stops the walk looking like a shuffle
    this.pelvis.rotation.y = damp(this.pelvis.rotation.y, moving ? sw * 0.1 * stride : 0, 10, dt);
    this.chest.rotation.y = damp(this.chest.rotation.y, moving ? -sw * 0.07 * stride : 0, 10, dt);
    this.neck.rotation.x = damp(this.neck.rotation.x, -pitch * 0.55, 14, dt);

    // ── arms ──
    const a = this.aimBlend;
    const [left, right] = this.arms;
    const swingR = moving ? -sw * 0.48 * stride : 0;
    const swingL = moving ? sw * 0.48 * stride : 0;
    const aimR = -1.42 - pitch * 0.75;
    const aimL = -1.28 - pitch * 0.7;

    right.shoulder.rotation.x = damp(right.shoulder.rotation.x,
      lerp(swingR - (a < 0.02 ? 0.3 : 0), aimR, a), 15, dt);
    right.shoulder.rotation.z = damp(right.shoulder.rotation.z, lerp(0.09, -0.1, a), 15, dt);
    right.elbow.rotation.x = damp(right.elbow.rotation.x,
      lerp(-0.38 - Math.abs(swingR) * 0.4, -0.2, a), 15, dt);

    left.shoulder.rotation.x = damp(left.shoulder.rotation.x, lerp(swingL, aimL, a), 15, dt);
    left.shoulder.rotation.z = damp(left.shoulder.rotation.z, lerp(-0.09, 0.44, a), 15, dt);
    left.elbow.rotation.x = damp(left.elbow.rotation.x,
      lerp(-0.38 - Math.abs(swingL) * 0.4, -0.62, a), 15, dt);

    // ── death: crumple ──
    if (this.deadBlend > 0.001) {
      const d = this.deadBlend;
      this.root.rotation.x = -Math.PI / 2 * d * 0.92;
      this.root.position.y = this._baseY - 0.04 * d;
      this.chest.rotation.x += d * 0.5;
      for (const leg of this.legs) leg.knee.rotation.x += d * 0.9;
      right.shoulder.rotation.x += d * 1.1;
      left.shoulder.rotation.x += d * 0.8;
    } else {
      this.root.rotation.x = 0;
    }
  }

  faceYaw(yaw, dt, rate = 12) {
    this.root.rotation.y += angleDelta(this.root.rotation.y, yaw) * (1 - Math.exp(-rate * dt));
  }

  setPosition(x, y, z) {
    this._baseY = y;
    this.root.position.set(x, y, z);
  }

  /**
   * Flash white on a hit. Geometry is shared, so only the material swaps —
   * and each mesh remembers its own, because the weapon in the hand is on a
   * metallic material and must not come back as skin.
   */
  flash() {
    if (this._flashing) return;
    this._flashing = true;
    this.root.traverse((m) => {
      if (!m.isMesh) return;
      m.userData.baseMaterial = m.userData.baseMaterial || m.material;
      m.material = FLASH_MATERIAL;
    });
    setTimeout(() => {
      this.root.traverse((m) => {
        if (m.isMesh && m.userData.baseMaterial) m.material = m.userData.baseMaterial;
      });
      this._flashing = false;
    }, 65);
  }

  /** Geometry is cached and shared between characters, so it is never freed. */
  dispose() { this.root.parent?.remove(this.root); }
}

const FLASH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffe3e3, toneMapped: false });

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
