import * as THREE from 'three';
import { clamp } from './utils.js';

/**
 * Static collision world: an array of axis-aligned boxes in a uniform XZ grid.
 *
 * Everything the level is built from is boxy, so AABBs are not an
 * approximation here - they're exact. That buys us a very cheap raycast and a
 * character controller that handles stairs without a navmesh or physics engine.
 */
const CELL = 6;

export class CollisionWorld {
  constructor() {
    /** @type {{x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,tag:string}[]} */
    this.boxes = [];
    this.grid = new Map();
    this.bounds = { x0: -Infinity, x1: Infinity, z0: -Infinity, z1: Infinity };
  }

  /** Add a box from centre + size. */
  addBox(cx, cy, cz, w, h, d, tag = 'world') {
    this.boxes.push({
      x0: cx - w / 2, y0: cy - h / 2, z0: cz - d / 2,
      x1: cx + w / 2, y1: cy + h / 2, z1: cz + d / 2,
      tag,
    });
  }

  addMinMax(x0, y0, z0, x1, y1, z1, tag = 'world') {
    this.boxes.push({ x0, y0, z0, x1, y1, z1, tag });
  }

  /**
   * Insert a box after build() - used by deployable cover. The box is spliced
   * straight into the broadphase grid; removal just flags it off, which every
   * query skips, so no rebuild is ever needed.
   */
  addLive(cx, cy, cz, w, h, d, tag = 'deployable') {
    const b = {
      x0: cx - w / 2, y0: cy - h / 2, z0: cz - d / 2,
      x1: cx + w / 2, y1: cy + h / 2, z1: cz + d / 2,
      tag, off: false,
    };
    const i = this.boxes.push(b) - 1;
    const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
    const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
    for (let gx = cx0; gx <= cx1; gx++) {
      for (let gz = cz0; gz <= cz1; gz++) {
        const k = CollisionWorld.key(gx, gz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(i);
      }
    }
    return b;
  }

  removeLive(box) { if (box) box.off = true; }

  static key(cx, cz) { return cx * 100000 + cz; }

  /** Bucket every box into the broadphase grid. Call once after building. */
  build() {
    this.grid.clear();
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
      const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const k = CollisionWorld.key(cx, cz);
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(i);
        }
      }
    }
  }

  /** Indices of boxes whose cells overlap the XZ rect. */
  query(x0, z0, x1, z1, out) {
    out.length = 0;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.grid.get(CollisionWorld.key(cx, cz));
        if (!arr) continue;
        for (const i of arr) if (!out.includes(i)) out.push(i);
      }
    }
    return out;
  }

  /* ── raycast ──────────────────────────────────────────────────
   * Grid-marched (2D DDA over XZ) slab test. Returns the nearest hit.
   * ─────────────────────────────────────────────────────────────── */
  raycast(origin, dir, maxDist = 500, hit = {}) {
    let best = maxDist, bi = -1;

    let cx = Math.floor(origin.x / CELL);
    let cz = Math.floor(origin.z / CELL);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const invX = dir.x !== 0 ? 1 / Math.abs(dir.x) : Infinity;
    const invZ = dir.z !== 0 ? 1 / Math.abs(dir.z) : Infinity;
    // distance along the ray to the next cell boundary on each axis
    let tMaxX = dir.x !== 0
      ? (((dir.x > 0 ? cx + 1 : cx) * CELL) - origin.x) / dir.x : Infinity;
    let tMaxZ = dir.z !== 0
      ? (((dir.z > 0 ? cz + 1 : cz) * CELL) - origin.z) / dir.z : Infinity;
    const tDeltaX = CELL * invX;
    const tDeltaZ = CELL * invZ;

    let travelled = 0;
    let guard = 0;
    const seen = new Set();

    while (travelled <= best && guard++ < 4096) {
      const arr = this.grid.get(CollisionWorld.key(cx, cz));
      if (arr) {
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (this.boxes[i].off) continue;
          const t = rayBox(origin, dir, this.boxes[i]);
          if (t >= 0 && t < best) { best = t; bi = i; }
        }
      }
      if (tMaxX < tMaxZ) { travelled = tMaxX; cx += stepX; tMaxX += tDeltaX; }
      else { travelled = tMaxZ; cz += stepZ; tMaxZ += tDeltaZ; }
      if (!isFinite(travelled)) break;
    }

    if (bi < 0) return null;
    hit.distance = best;
    hit.box = this.boxes[bi];
    hit.point = (hit.point || new THREE.Vector3())
      .copy(origin).addScaledVector(dir, best);
    hit.normal = boxNormal(hit.point, hit.box, hit.normal || new THREE.Vector3());
    return hit;
  }

  /** Cheap boolean line-of-sight test. */
  losBlocked(a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 0.001) return false;
    _d.multiplyScalar(1 / len);
    return this.raycast(a, _d, len - 0.05, _tmpHit) !== null;
  }

  /* ── character controller ─────────────────────────────────────
   * `body` = { pos (feet), vel, radius, height, onGround, stepHeight }
   * Horizontal pass ignores anything short enough to step onto; the vertical
   * pass then lifts the body on to it, which is what makes stairs work.
   * ─────────────────────────────────────────────────────────────── */
  moveBody(body, dt) {
    const r = body.radius, h = body.height;
    const step = body.stepHeight ?? 0.42;

    // ---- horizontal -------------------------------------------------
    body.pos.x += body.vel.x * dt;
    body.pos.z += body.vel.z * dt;
    body.hitWall = false;

    const feet = body.pos.y;
    const headY = feet + h;
    const solidFrom = feet + step; // below this we can step up instead

    this.query(body.pos.x - r, body.pos.z - r, body.pos.x + r, body.pos.z + r, _idx);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const i of _idx) {
        const b = this.boxes[i];
        if (b.off) continue;
        if (b.y1 <= solidFrom || b.y0 >= headY) continue; // steppable or overhead

        const cx = clamp(body.pos.x, b.x0, b.x1);
        const cz = clamp(body.pos.z, b.z0, b.z1);
        const dx = body.pos.x - cx, dz = body.pos.z - cz;
        const d2 = dx * dx + dz * dz;

        if (d2 > r * r) continue;

        if (d2 > 1e-8) {
          // outside the rect: push straight out along the closest-point normal
          const d = Math.sqrt(d2);
          const push = r - d;
          body.pos.x += (dx / d) * push;
          body.pos.z += (dz / d) * push;
        } else {
          // centre is inside the rect: escape via the shallowest face
          const pxp = b.x1 - body.pos.x + r, pxn = body.pos.x - b.x0 + r;
          const pzp = b.z1 - body.pos.z + r, pzn = body.pos.z - b.z0 + r;
          const m = Math.min(pxp, pxn, pzp, pzn);
          if (m === pxp) body.pos.x += pxp;
          else if (m === pxn) body.pos.x -= pxn;
          else if (m === pzp) body.pos.z += pzp;
          else body.pos.z -= pzn;
        }
        moved = true;
        body.hitWall = true;
      }
      if (!moved) break;
    }

    // ---- vertical ---------------------------------------------------
    body.vel.y -= GRAVITY * dt;
    if (body.vel.y < -55) body.vel.y = -55;
    const prevFeet = body.pos.y;
    body.pos.y += body.vel.y * dt;

    const ground = this.groundHeight(body.pos.x, body.pos.z, prevFeet + step, r);

    const wasGround = body.onGround;
    body.onGround = false;

    if (body.pos.y <= ground + 0.001) {
      body.pos.y = ground;
      if (body.vel.y < 0) body.vel.y = 0;
      body.onGround = true;
    } else if (wasGround && body.vel.y <= 0 && body.pos.y - ground < step) {
      // walking up / down a small lip - snap so we don't bunny-hop stairs
      body.pos.y = ground;
      body.vel.y = 0;
      body.onGround = true;
    }

    // ceiling
    const ceil = this.ceilHeight(body.pos.x, body.pos.z, body.pos.y, h, r);
    if (ceil !== Infinity && body.pos.y + h > ceil) {
      body.pos.y = Math.max(ground, ceil - h);
      if (body.vel.y > 0) body.vel.y = 0;
    }

    if (body.pos.y < FLOOR_KILL) { body.pos.y = FLOOR_KILL; body.vel.y = 0; body.onGround = true; }
    return body;
  }

  /** Highest surface under the footprint that is at most `maxY` high. */
  groundHeight(x, z, maxY, r) {
    this.query(x - r, z - r, x + r, z + r, _idx2);
    let g = FLOOR_KILL;
    for (const i of _idx2) {
      const b = this.boxes[i];
      if (b.off) continue;
      if (b.y1 > maxY || b.y1 < g) continue;
      if (x + r <= b.x0 || x - r >= b.x1 || z + r <= b.z0 || z - r >= b.z1) continue;
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > r * r) continue;
      g = b.y1;
    }
    return g;
  }

  ceilHeight(x, z, feet, h, r) {
    this.query(x - r, z - r, x + r, z + r, _idx2);
    let c = Infinity;
    for (const i of _idx2) {
      const b = this.boxes[i];
      if (b.off) continue;
      if (b.y0 < feet + 0.15 || b.y0 > c) continue;
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > r * r) continue;
      c = b.y0;
    }
    return c;
  }

  /**
   * True if a capsule at this spot would be intersecting geometry.
   * `clear` is how far above the feet something has to rise before it counts
   * as an obstruction — pass the mover's step height so stair treads and kerbs
   * don't read as walls.
   */
  isBlocked(x, y, z, r, h, clear = 0.4) {
    this.query(x - r, z - r, x + r, z + r, _idx2);
    for (const i of _idx2) {
      const b = this.boxes[i];
      if (b.off) continue;
      if (b.y1 <= y + clear || b.y0 >= y + h) continue;
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
}

export const GRAVITY = 22;
const FLOOR_KILL = -6;

const _idx = [];
const _idx2 = [];
const _d = new THREE.Vector3();
const _tmpHit = {};

/** Slab test. Returns entry distance, or -1. Rays starting inside return 0. */
function rayBox(o, d, b) {
  let tmin = 0, tmax = Infinity;

  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const lo = a === 0 ? b.x0 : a === 1 ? b.y0 : b.z0;
    const hi = a === 0 ? b.x1 : a === 1 ? b.y1 : b.z1;

    if (Math.abs(da) < 1e-8) {
      if (oa < lo || oa > hi) return -1;
    } else {
      let t1 = (lo - oa) / da;
      let t2 = (hi - oa) / da;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

function boxNormal(p, b, out) {
  const e = 0.002;
  if (Math.abs(p.x - b.x0) < e) return out.set(-1, 0, 0);
  if (Math.abs(p.x - b.x1) < e) return out.set(1, 0, 0);
  if (Math.abs(p.y - b.y0) < e) return out.set(0, -1, 0);
  if (Math.abs(p.y - b.y1) < e) return out.set(0, 1, 0);
  if (Math.abs(p.z - b.z0) < e) return out.set(0, 0, -1);
  return out.set(0, 0, 1);
}
