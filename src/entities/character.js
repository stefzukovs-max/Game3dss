import * as THREE from 'three';
import { makeRNG, clamp, damp, lerp, angleDelta } from '../core/utils.js';

/**
 * A blocky humanoid built from boxes, animated procedurally. No skeleton, no
 * animation clips - just a hierarchy of pivots driven by speed and aim, which
 * is plenty for a stylised game and costs nothing to load.
 *
 * Local Y is measured from the feet. Total height ≈ 1.82 m.
 */

const GEO = new Map();
function box(w, h, d) {
  const k = `${w}|${h}|${d}`;
  let g = GEO.get(k);
  if (!g) GEO.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}

const MAT = new Map();
function mat(color, opts = '') {
  const k = color + '|' + opts;
  let m = MAT.get(k);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    if (opts === 'flat') m.flatShading = true;
    MAT.set(k, m);
  }
  return m;
}

const SKINS = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a21, 0xa1665e, 0x6f4331];

const GANG_SHIRTS = [0xf2f2f2, 0xffd23f, 0x2fb0a0, 0xe94f37, 0x2b3a55, 0x111111,
  0x4f9d4f, 0xff7a2f, 0x8a2be2];
const GANG_PANTS = [0x2b3a55, 0x3a3a3a, 0x6b5b3e, 0x1f2937, 0x8b8378];
const BANDANAS = [0xe11d48, 0xffd23f, 0x22c55e, 0x3b82f6, 0xffffff, 0x111111];

const COP_SHIRT = 0x1d2a44;
const COP_SHIRT_ALT = 0x23303f;
const COP_PANTS = 0x151c2b;
const COP_VEST = 0x11151f;
const ELITE = 0x0e0f12;

/** Roll a look for a fighter of the given faction. */
export function makeOutfit(faction, rank, rng = makeRNG(Math.random() * 1e9)) {
  const skin = rng.pick(SKINS);
  if (faction === 'police') {
    const elite = rank === 'elite';
    return {
      skin,
      shirt: elite ? ELITE : rng.chance(0.5) ? COP_SHIRT : COP_SHIRT_ALT,
      pants: elite ? ELITE : COP_PANTS,
      vest: elite ? 0x0a0b0d : COP_VEST,
      hasVest: true,
      helmet: elite || rng.chance(0.55),
      helmetColor: elite ? 0x0a0b0d : 0x1a2130,
      cap: false,
      bandana: null,
      shorts: false,
      visor: elite,
      shoes: 0x14161a,
    };
  }
  const shorts = rng.chance(0.55);
  return {
    skin,
    shirt: rng.pick(GANG_SHIRTS),
    pants: rng.pick(GANG_PANTS),
    vest: null,
    hasVest: rank === 'elite' && rng.chance(0.6),
    helmet: false,
    cap: rng.chance(0.5),
    capColor: rng.pick(GANG_SHIRTS),
    bandana: rng.chance(0.45) ? rng.pick(BANDANAS) : null,
    shorts,
    visor: false,
    shoes: rng.chance(0.5) ? 0xf2f2f2 : 0x22252b,
    tank: rng.chance(0.4),
  };
}

export class CharacterModel {
  constructor(outfit) {
    this.o = outfit;
    this.root = new THREE.Group();
    this.phase = Math.random() * Math.PI * 2;
    this.lean = 0;
    this.aimBlend = 0;
    this.crouchBlend = 0;
    this.deadBlend = 0;
    this._build();
  }

  _build() {
    const o = this.o;
    const skin = mat(o.skin);
    const shirt = mat(o.shirt);
    const pants = mat(o.pants);
    const shoe = mat(o.shoes);

    const add = (parent, geo, m, x, y, z) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // ── pelvis ──
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 0.92;
    this.root.add(this.pelvis);
    add(this.pelvis, box(0.34, 0.22, 0.22), pants, 0, -0.02, 0);

    // ── legs ──
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.105, 0.9, 0);
      this.root.add(hip);
      const thighMat = o.shorts ? pants : pants;
      add(hip, box(0.155, 0.44, 0.18), thighMat, 0, -0.22, 0);

      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      add(knee, box(0.135, 0.4, 0.155), o.shorts ? skin : pants, 0, -0.2, 0);
      add(knee, box(0.15, 0.1, 0.27), shoe, 0, -0.43, 0.045);

      this.legs.push({ hip, knee, side: s });
    }

    // ── chest ──
    this.chest = new THREE.Group();
    this.chest.position.y = 0.92;
    this.root.add(this.chest);
    add(this.chest, box(0.42, 0.6, 0.24), o.tank ? skin : shirt, 0, 0.3, 0);
    if (o.tank) {
      // tank top over bare shoulders
      add(this.chest, box(0.3, 0.44, 0.26), shirt, 0, 0.24, 0);
    }
    if (o.hasVest) {
      this.vest = add(this.chest, box(0.46, 0.46, 0.3), mat(o.vest ?? 0x11151f), 0, 0.3, 0);
      // shoulder pads
      add(this.chest, box(0.58, 0.1, 0.26), mat(o.vest ?? 0x11151f), 0, 0.5, 0);
    }

    // ── head ──
    this.neck = new THREE.Group();
    this.neck.position.y = 0.62;
    this.chest.add(this.neck);
    add(this.neck, box(0.12, 0.08, 0.12), skin, 0, 0.02, 0);
    this.head = add(this.neck, box(0.23, 0.25, 0.23), skin, 0, 0.18, 0);
    // face: a darker slab so you can tell which way someone is looking
    add(this.neck, box(0.2, 0.09, 0.03), mat(0x2a1e18), 0, 0.2, 0.115);

    if (o.helmet) {
      add(this.neck, box(0.27, 0.16, 0.28), mat(o.helmetColor), 0, 0.27, 0);
      add(this.neck, box(0.27, 0.05, 0.1), mat(o.helmetColor), 0, 0.21, 0.15);
      if (o.visor) add(this.neck, box(0.24, 0.1, 0.03), mat(0x2b3440), 0, 0.19, 0.125);
    } else if (o.cap) {
      add(this.neck, box(0.25, 0.09, 0.25), mat(o.capColor), 0, 0.31, 0);
      add(this.neck, box(0.24, 0.03, 0.13), mat(o.capColor), 0, 0.27, 0.17);
    }
    if (o.bandana) {
      add(this.neck, box(0.24, 0.1, 0.24), mat(o.bandana), 0, 0.08, 0);
    }

    // ── arms ──
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.27, 0.5, 0);
      this.chest.add(sh);
      add(sh, box(0.12, 0.34, 0.14), o.tank ? skin : shirt, 0, -0.17, 0);

      const elbow = new THREE.Group();
      elbow.position.y = -0.34;
      sh.add(elbow);
      add(elbow, box(0.11, 0.32, 0.12), skin, 0, -0.16, 0);
      const hand = new THREE.Group();
      hand.position.y = -0.33;
      elbow.add(hand);
      add(hand, box(0.1, 0.1, 0.11), skin, 0, 0, 0);

      this.arms.push({ shoulder: sh, elbow, hand, side: s });
    }
    this.rightHand = this.arms[1].hand;
    this.leftHand = this.arms[0].hand;
  }

  /** Where the muzzle flash / tracer should originate if no weapon override. */
  get handWorld() {
    return this.rightHand.getWorldPosition(_v);
  }

  /**
   * @param {object} s state
   *   speed      horizontal speed (m/s)
   *   aiming     bool
   *   crouching  bool
   *   pitch      look pitch, radians (+up)
   *   dead       bool
   *   moveDir    -1..1 lateral lean hint
   */
  update(dt, s) {
    const o = this.o;

    this.aimBlend = damp(this.aimBlend, s.aiming ? 1 : 0, 14, dt);
    this.crouchBlend = damp(this.crouchBlend, s.crouching ? 1 : 0, 12, dt);
    this.deadBlend = damp(this.deadBlend, s.dead ? 1 : 0, s.dead ? 7 : 20, dt);

    const speed = s.speed || 0;
    const moving = speed > 0.25;

    // ── locomotion cycle ──
    const stride = clamp(speed / 5.2, 0, 1.35);
    this.phase += dt * (2.6 + speed * 1.55);
    const sw = Math.sin(this.phase);
    const sw2 = Math.sin(this.phase * 2);

    const amp = moving ? 0.55 * stride + 0.12 : 0;
    for (const leg of this.legs) {
      const d = leg.side < 0 ? 1 : -1;
      const target = amp * sw * d;
      leg.hip.rotation.x = damp(leg.hip.rotation.x, target - this.crouchBlend * 0.75, 18, dt);
      // knee only bends backwards, and mostly on the return swing
      const bend = moving ? Math.max(0, -sw * d) * amp * 1.5 + 0.05 : 0.02;
      leg.knee.rotation.x = damp(leg.knee.rotation.x, bend + this.crouchBlend * 1.35, 18, dt);
    }

    // ── torso ──
    const bob = moving ? Math.abs(sw2) * 0.035 * stride : Math.sin(this.phase * 0.6) * 0.008;
    this.chest.position.y = 0.92 + bob - this.crouchBlend * 0.34;
    this.pelvis.position.y = 0.92 + bob * 0.5 - this.crouchBlend * 0.34;
    for (const leg of this.legs) leg.hip.position.y = 0.9 - this.crouchBlend * 0.3;

    const pitch = clamp(s.pitch || 0, -0.9, 0.9);
    this.chest.rotation.x = damp(this.chest.rotation.x,
      -pitch * 0.35 + (moving ? 0.09 * stride : 0) + this.crouchBlend * 0.18, 12, dt);
    this.chest.rotation.z = damp(this.chest.rotation.z, -(s.lean || 0) * 0.12, 8, dt);
    this.neck.rotation.x = damp(this.neck.rotation.x, -pitch * 0.55, 14, dt);

    // ── arms ──
    const a = this.aimBlend;
    const right = this.arms[1], left = this.arms[0];

    // idle/run swing
    const swingR = moving ? -sw * 0.5 * stride : 0;
    const swingL = moving ? sw * 0.5 * stride : 0;

    // aim pose: right arm out front, left arm crossing to support
    const aimR = -1.42 - pitch * 0.75;
    const aimL = -1.30 - pitch * 0.7;

    right.shoulder.rotation.x = damp(right.shoulder.rotation.x, lerp(swingR, aimR, a), 15, dt);
    right.shoulder.rotation.z = damp(right.shoulder.rotation.z, lerp(0.07, -0.12, a), 15, dt);
    right.elbow.rotation.x = damp(right.elbow.rotation.x, lerp(-0.25 - Math.abs(swingR) * 0.4, -0.16, a), 15, dt);

    left.shoulder.rotation.x = damp(left.shoulder.rotation.x, lerp(swingL, aimL, a), 15, dt);
    left.shoulder.rotation.z = damp(left.shoulder.rotation.z, lerp(-0.07, 0.42, a), 15, dt);
    left.elbow.rotation.x = damp(left.elbow.rotation.x, lerp(-0.25 - Math.abs(swingL) * 0.4, -0.55, a), 15, dt);

    // lowered-weapon idle: keep the right arm half raised so the gun still reads
    if (a < 0.02 && !s.dead) {
      right.shoulder.rotation.x = damp(right.shoulder.rotation.x, swingR - 0.35, 12, dt);
    }

    // ── death: crumple forward and sink ──
    if (this.deadBlend > 0.001) {
      const d = this.deadBlend;
      this.root.rotation.x = -Math.PI / 2 * d * 0.92;
      this.root.position.y = this._baseY - 0.05 * d;
      this.chest.rotation.x += d * 0.5;
      for (const leg of this.legs) leg.knee.rotation.x += d * 0.9;
      right.shoulder.rotation.x += d * 1.1;
      left.shoulder.rotation.x += d * 0.8;
    } else {
      this.root.rotation.x = 0;
    }
  }

  /** Smoothly turn the body toward a yaw, with the head leading. */
  faceYaw(yaw, dt, rate = 12) {
    const d = angleDelta(this.root.rotation.y, yaw);
    this.root.rotation.y += d * (1 - Math.exp(-rate * dt));
  }

  setPosition(x, y, z) {
    this._baseY = y;
    this.root.position.set(x, y, z);
  }

  /** Flash the whole model white for a moment when hit. */
  flash() {
    if (this._flashing) return;
    this._flashing = true;
    // Materials are shared between characters, so swap rather than mutate.
    this.root.traverse((m) => {
      if (!m.isMesh) return;
      if (!m.userData._orig) m.userData._orig = m.material;
      m.material = _flashMat;
    });
    setTimeout(() => {
      this.root.traverse((m) => {
        if (m.isMesh && m.userData._orig) m.material = m.userData._orig;
      });
      this._flashing = false;
    }, 60);
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}

const _flashMat = new THREE.MeshBasicMaterial({ color: 0xffdddd });
const _v = new THREE.Vector3();
