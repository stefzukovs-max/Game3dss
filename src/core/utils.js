import * as THREE from 'three';

/* ── math helpers ─────────────────────────────────────────────── */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Framerate-independent exponential approach. `rate` ~ how fast, in 1/s. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Shortest signed angle from a to b (radians). */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ── seeded RNG (mulberry32) ──────────────────────────────────── */
export function makeRNG(seed = 1337) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + r() * (b - a);
  r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = (p) => r() < p;
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}

/* ── geometry merging ─────────────────────────────────────────────
 * Three's BufferGeometryUtils lives in the addons bundle, which we don't
 * vendor. This does the one thing the level builder needs: bake a pile of
 * transformed, non-indexed geometries into a single buffer per material.
 * ───────────────────────────────────────────────────────────────── */
export class GeometryBatcher {
  constructor() { this.pos = []; this.nor = []; this.uv = []; }

  /** @param {THREE.BufferGeometry} geo already non-indexed */
  add(geo, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const u = g.attributes.uv.array;

    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();

    for (let i = 0; i < p.length; i += 3) {
      v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < u.length; i++) this.uv.push(u[i]);
  }

  get empty() { return this.pos.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * BoxGeometry with UVs rescaled to world units so a tiling texture keeps a
 * constant real-world size regardless of how big the box is.
 * Face order in BoxGeometry: +X, -X, +Y, -Y, +Z, -Z (4 verts each, indexed).
 */
export function texturedBox(w, h, d, texelsPerMeter = 0.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const s = texelsPerMeter;
  const spans = [
    [d, h], [d, h],   // +X, -X
    [w, d], [w, d],   // +Y, -Y
    [w, h], [w, h],   // +Z, -Z
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * su * s, uv.getY(k) * sv * s);
    }
  }
  return g;
}

/* ── misc ─────────────────────────────────────────────────────── */
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
}

/** Random point on a cone around `dir` with half-angle `spread` (radians). */
export function coneSpread(dir, spread, out = new THREE.Vector3()) {
  out.copy(dir);
  if (spread <= 0) return out;
  const a = Math.random() * Math.PI * 2;
  // sqrt for uniform area distribution across the cone's cap
  const r = Math.sqrt(Math.random()) * spread;
  const up = Math.abs(dir.y) > 0.95 ? _X : _Y;
  const t1 = new THREE.Vector3().crossVectors(dir, up).normalize();
  const t2 = new THREE.Vector3().crossVectors(dir, t1).normalize();
  out.addScaledVector(t1, Math.tan(r) * Math.cos(a));
  out.addScaledVector(t2, Math.tan(r) * Math.sin(a));
  return out.normalize();
}
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

/* ── game clock ────────────────────────────────────────────────────
 * Simulation time, not wall-clock. Everything rate-gated (fire rate,
 * reloads, cooldowns, buff timers) reads this, so the game behaves the same
 * under a frame drop and nothing ticks down while paused.
 * ────────────────────────────────────────────────────────────────── */
let _clock = 0;
export const now = () => _clock;
export const advanceClock = (dt) => { _clock += dt; return _clock; };
export const resetClock = () => { _clock = 0; };
