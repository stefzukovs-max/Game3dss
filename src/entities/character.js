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
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  /** @param {THREE.BufferGeometry} geo @param {THREE.Matrix4} m @param {number} hex */
  add(geo, m, hex) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const nm = _nm.getNormalMatrix(m);
    _c.setHex(hex, THREE.SRGBColorSpace);

    for (let i = 0; i < p.length; i += 3) {
      _v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
  }

  get empty() { return this.pos.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
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

/* ── outfits ──────────────────────────────────────────────────────────
 * A small preset table rather than free randomisation: the crew reads as a
 * crew, the battalion reads as a unit, and every preset's merged geometry
 * gets built once and shared.
 * ─────────────────────────────────────────────────────────────────── */
const SKINS = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x6b4423, 0xa1665e];
const HAIR = [0x1b1310, 0x2e2119, 0x4a3020, 0x14100e, 0x5a4632];

const CREW_PRESETS = [
  { shirt: 0xf2f2f2, pants: 0x2b3a55, head: 'cap',     capColor: 0xe11d48, tank: true },
  { shirt: 0xffd23f, pants: 0x3a3a3a, head: 'bandana', bandana: 0xe11d48, shorts: true },
  { shirt: 0x2fb0a0, pants: 0x1f2937, head: 'none',    tank: true, shorts: true },
  { shirt: 0xe94f37, pants: 0x6b5b3e, head: 'cap',     capColor: 0x111111 },
  { shirt: 0x111111, pants: 0x2b3a55, head: 'bandana', bandana: 0xffd23f },
  { shirt: 0x4f9d4f, pants: 0x8b8378, head: 'none',    shorts: true },
  { shirt: 0xff7a2f, pants: 0x1f2937, head: 'cap',     capColor: 0xf2f2f2, tank: true },
  { shirt: 0x7f6fd4, pants: 0x3a3a3a, head: 'bandana', bandana: 0xffffff },
];

const COP_PRESETS = [
  { shirt: 0x1d2a44, pants: 0x151c2b, head: 'helmet', helmet: 0x1a2130, vest: 0x11151f },
  { shirt: 0x23303f, pants: 0x151c2b, head: 'cap',    capColor: 0x151c2b, vest: 0x11151f },
  { shirt: 0x1d2a44, pants: 0x151c2b, head: 'helmet', helmet: 0x151c2b, vest: 0x0f1219 },
  { shirt: 0x22303c, pants: 0x171d29, head: 'none',   vest: 0x11151f },
];

const ELITE_PRESETS = [
  { shirt: 0x0e0f12, pants: 0x0e0f12, head: 'helmet', helmet: 0x0a0b0d, vest: 0x0a0b0d, visor: true },
  { shirt: 0x14161a, pants: 0x0e0f12, head: 'helmet', helmet: 0x101216, vest: 0x0a0b0d, visor: true },
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
    frame: 'normal',
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
  if (o.vest) {
    P.chest.add(torsoGeo(broad), at(0, 0.075, 0, 1.09, 0.72, 1.16), o.vest);
    P.chest.add(ball(0.088), at(-0.185, 0.535, 0), o.vest);
    P.chest.add(ball(0.088), at(0.185, 0.535, 0), o.vest);
  }
  // neck + collar
  P.chest.add(tube(0.075, 0.055), at(0, 0.598, 0), o.shirt);
  P.chest.add(capsule(0.054, 0.06), at(0, 0.645, 0), skin);

  // ── head (pivots at the neck) ──
  P.head.add(capsule(0.052, 0.05), at(0, 0.03, 0), skin);
  P.head.add(ball(0.115), at(0, 0.16, 0, 1.0, 1.13, 1.04), skin);
  // brow + eyes give the head a facing at a glance
  P.head.add(ball(0.0165), at(-0.043, 0.168, 0.1), 0x1a1108);
  P.head.add(ball(0.0165), at(0.043, 0.168, 0.1), 0x1a1108);

  if (o.head === 'helmet') {
    P.head.add(dome(0.132), at(0, 0.135, 0, 1.0, 1.08, 1.06), o.helmet);
    P.head.add(tube(0.133, 0.035), at(0, 0.138, 0), o.helmet);
    P.head.add(ball(0.055), at(0, 0.14, 0.115, 1.9, 0.28, 1.0), o.helmet);   // brow guard
    if (o.visor) P.head.add(ball(0.108), at(0, 0.155, 0.035, 1.02, 0.72, 1.12), 0x23303d);
  } else if (o.head === 'cap') {
    P.head.add(dome(0.124), at(0, 0.15, 0, 1.0, 0.95, 1.02), o.capColor);
    P.head.add(ball(0.06), at(0, 0.152, 0.115, 1.7, 0.2, 1.25), o.capColor);  // peak
    P.head.add(dome(0.118), at(0, 0.12, -0.01, 1, 0.75, 1), o.hair);
  } else if (o.head === 'bandana') {
    P.head.add(dome(0.121), at(0, 0.14, 0, 1.0, 0.72, 1.02), o.bandana);
    P.head.add(ball(0.032), at(0, 0.15, -0.11, 1, 0.7, 1.6), o.bandana);      // knot
  } else {
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
    // shin
    P['shin' + L].add(ball(legR * 0.86), at(0, 0.005, 0), legLower);
    P['shin' + L].add(capsule(legR * 0.78, 0.235), at(0, -0.19, 0), legLower);
    P['shin' + L].add(ball(0.066), at(0, -0.335, 0), legLower);   // ankle
    P['shin' + L].add(ball(0.072), at(0, -0.375, 0.05, 1.12, 0.66, 2.05), o.shoes);

    P['upper' + L].add(ball(armR * 1.25), at(0, -0.005, 0), armUpper);
    P['upper' + L].add(capsule(armR, 0.19), at(0, -0.155, 0), armUpper);
    P['fore' + L].add(ball(armR * 0.98), at(0, 0.005, 0), skin);
    P['fore' + L].add(capsule(armR * 0.88, 0.175), at(0, -0.145, 0), skin);
    P['hand' + L].add(ball(0.058), at(0, -0.015, 0, 1.0, 1.18, 0.88), skin);
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
