import * as THREE from 'three';
import { coneSpread, clamp } from '../core/utils.js';
import { audio } from '../core/audio.js';

/**
 * Hitscan resolution + every bullet-related visual. All effects come out of
 * fixed-size pools so a firefight never allocates.
 */

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 0, 1);
const _hit = {};
const _lookHit = {};
const _aim = new THREE.Vector3();
const _base = new THREE.Vector3();

/** Ray vs vertical cylinder. Returns entry distance or -1. */
function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1, maxT) {
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  const b = 2 * (px * dx + pz * dz);
  const c = px * px + pz * pz - r * r;

  let t = -1;
  if (a < 1e-9) {
    // ray is vertical: inside the circle?
    if (c > 0) return -1;
    t = 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t0 = (-b - sq) / (2 * a);
    const t1 = (-b + sq) / (2 * a);
    t = t0 >= 0 ? t0 : t1;
    if (t < 0) return -1;
  }
  if (t > maxT) return -1;

  let y = oy + dy * t;
  if (y >= y0 && y <= y1) return t;

  // entered above/below the cap - clip against the end planes
  if (Math.abs(dy) > 1e-9) {
    for (const capY of [y0, y1]) {
      const tc = (capY - oy) / dy;
      if (tc < 0 || tc > maxT) continue;
      const hx = ox + dx * tc - cx, hz = oz + dz * tc - cz;
      if (hx * hx + hz * hz <= r * r) return tc;
    }
  }
  return -1;
}

export class CombatSystem {
  constructor(scene, collision, tex) {
    this.scene = scene;
    this.collision = collision;
    this.tex = tex;
    this.effectsOn = true;
    this.time = 0;

    this._initPools();
  }

  _initPools() {
    const s = this.scene;

    // ── tracers: thin stretched boxes, additive ──
    this.tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd98a, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const tg = new THREE.BoxGeometry(0.05, 0.05, 1);
    tg.translate(0, 0, -0.5); // origin at the tail
    this.tracers = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(tg, this.tracerMat);
      m.visible = false;
      m.frustumCulled = false;
      m.matrixAutoUpdate = true;
      s.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0.06 });
    }
    this._tracerI = 0;

    // ── billboard puffs: muzzle flash, sparks, smoke, blood ──
    this.puffGeo = new THREE.PlaneGeometry(1, 1);
    this.puffMats = {
      flash: new THREE.MeshBasicMaterial({ map: this.tex.spark, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      spark: new THREE.MeshBasicMaterial({ map: this.tex.spark, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false }),
      smoke: new THREE.MeshBasicMaterial({ map: this.tex.smoke, transparent: true,
        depthWrite: false, opacity: 0.5, color: 0xb9b2a6 }),
      blood: new THREE.MeshBasicMaterial({ map: this.tex.smoke, transparent: true,
        depthWrite: false, color: 0x9e1b1b }),
    };
    this.puffs = [];
    for (let i = 0; i < 110; i++) {
      const m = new THREE.Mesh(this.puffGeo, this.puffMats.spark);
      m.visible = false;
      m.frustumCulled = false;
      s.add(m);
      this.puffs.push({
        mesh: m, life: 0, max: 1, size0: 1, size1: 1,
        vel: new THREE.Vector3(), grav: 0, spin: 0, kind: 'spark',
      });
    }
    this._puffI = 0;

    // ── bullet-hole decals ──
    this.decalMat = new THREE.MeshBasicMaterial({
      map: this.tex.hole, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.9,
    });
    this.decalGeo = new THREE.PlaneGeometry(0.22, 0.22);
    this.decals = [];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat);
      m.visible = false;
      s.add(m);
      this.decals.push(m);
    }
    this._decalI = 0;

    // ── one shared muzzle light, moved to whoever fired last ──
    this.flashLight = new THREE.PointLight(0xffcc77, 0, 13, 2);
    s.add(this.flashLight);
    this._flashT = 0;
  }

  /* ── the shot ─────────────────────────────────────────────────
   * `origin`/`dir` define the aim ray (usually from the camera). `muzzle` is
   * where the tracer visually starts. Returns an array of damage events.
   * ─────────────────────────────────────────────────────────────── */
  fire(shooter, origin, dir, weapon, targets, opts = {}) {
    const def = weapon.def || weapon;
    const spread = opts.spread ?? 0;
    const results = [];
    const muzzle = opts.muzzle || origin;
    const maxRange = def.range * 2.2;

    /*
     * Converge on the crosshair. The aim ray starts at the camera, which sits
     * behind and to one side of the shooter - firing straight down it would
     * send bullets past everything the crosshair is actually on. So: find
     * where the crosshair lands, then shoot from the muzzle at that point.
     */
    const look = this.collision.raycast(origin, dir, maxRange, _lookHit);
    let lookDist = look ? look.distance : maxRange;

    // Converge on whatever the crosshair is actually over, characters
    // included. Using only world geometry puts the convergence point on the
    // wall *behind* a target, and the muzzle's offset then carries the shot
    // wide by more than the weapon's own spread.
    for (const t of targets) {
      if (t === shooter || !t.alive) continue;
      const th = rayCylinder(
        origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        t.pos.x, t.pos.z, t.radius * 1.28,
        t.pos.y + 0.15, t.pos.y + t.standHeight * (t.crouching ? 0.72 : 1),
        lookDist,
      );
      if (th >= 0 && th < lookDist) lookDist = th;
    }

    _aim.copy(origin).addScaledVector(dir, lookDist);
    _base.subVectors(_aim, muzzle);
    if (_base.lengthSq() < 0.36) _base.copy(dir); else _base.normalize();

    for (let p = 0; p < (def.pellets || 1); p++) {
      coneSpread(_base, spread, _d);
      _o.copy(muzzle);
      const wall = this.collision.raycast(_o, _d, maxRange, _hit);
      let bestT = wall ? wall.distance : maxRange;
      let victim = null;
      let zone = 'body';

      for (const t of targets) {
        if (t === shooter || !t.alive) continue;
        const th = rayCylinder(
          _o.x, _o.y, _o.z, _d.x, _d.y, _d.z,
          t.pos.x, t.pos.z, t.radius * 1.28,
          t.pos.y + 0.15, t.pos.y + t.standHeight * (t.crouching ? 0.72 : 1),
          bestT,
        );
        if (th >= 0 && th < bestT) {
          bestT = th;
          victim = t;
          const hy = _o.y + _d.y * th - t.pos.y;
          const top = t.standHeight * (t.crouching ? 0.72 : 1);
          zone = hy > top * 0.855 ? 'head' : hy > top * 0.45 ? 'body' : 'legs';
        }
      }

      _p.copy(_o).addScaledVector(_d, bestT);

      if (victim) {
        const falloff = this._falloff(def, bestT);
        let dmg = def.damage * falloff;
        if (zone === 'head') dmg *= def.headMul || 2;
        else if (zone === 'legs') dmg *= 0.78;
        results.push({ target: victim, damage: dmg, zone, point: _p.clone(), dir: _d.clone(), dist: bestT });
        this.bloodBurst(_p, _d);
        audio.impact(_p, 'flesh');
      } else if (wall) {
        this.impact(_p, wall.normal, wall.box.tag);
      }

      this.tracer(muzzle, _p, def);
    }

    this.muzzleFlash(muzzle, dir, def);
    audio.gunshot(muzzle, { size: def.sndSize || 1 });
    return results;
  }

  _falloff(def, dist) {
    if (dist <= def.range) return 1;
    const over = dist - def.range;
    return clamp(1 - (over / def.range) * (1 - def.falloff) * 2.2, def.falloff * 0.5, 1);
  }

  /* ── effects ──────────────────────────────────────────────── */
  tracer(from, to, def) {
    const t = this.tracers[this._tracerI = (this._tracerI + 1) % this.tracers.length];
    const len = from.distanceTo(to);
    if (len < 0.2) return;
    t.mesh.position.copy(to);
    t.mesh.lookAt(from);
    const thin = def && def.pellets > 1 ? 0.55 : 1;
    t.mesh.scale.set(thin, thin, len);
    t.mesh.visible = true;
    t.life = 0;
    t.max = 0.035 + Math.min(len, 90) / 900;
  }

  muzzleFlash(pos, dir, def) {
    const size = 0.5 + (def?.sndSize || 1) * 0.42;
    this.puff(pos, 'flash', {
      size0: size, size1: size * 0.35, life: 0.055, spin: Math.random() * 6,
    });
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 7 * size;
    this._flashT = 0.055;

    if (this.effectsOn) {
      _n.copy(dir).multiplyScalar(1.6);
      this.puff(pos, 'smoke', {
        size0: 0.22, size1: 1.15, life: 0.7,
        vel: _n.set(dir.x * 1.6 + (Math.random() - 0.5), dir.y * 1.4 + 0.5, dir.z * 1.6 + (Math.random() - 0.5)),
        grav: -0.4,
      });
    }
  }

  impact(point, normal, tag = 'world') {
    const kind =
      tag === 'vehicle' || tag === 'prop' || tag === 'pole' ? 'metal' :
      tag === 'shack' || tag === 'stall' ? 'wood' : 'concrete';
    audio.impact(point, kind);
    if (!this.effectsOn) return;

    // sparks kick back along the surface normal
    for (let i = 0; i < 3; i++) {
      this.puff(point, 'spark', {
        size0: 0.14, size1: 0.02, life: 0.13 + Math.random() * 0.1,
        vel: new THREE.Vector3(
          normal.x * 2.2 + (Math.random() - 0.5) * 3,
          normal.y * 2.2 + Math.random() * 2.4,
          normal.z * 2.2 + (Math.random() - 0.5) * 3),
        grav: 7,
      });
    }
    this.puff(point, 'smoke', {
      size0: 0.15, size1: 0.85, life: 0.55,
      vel: new THREE.Vector3(normal.x * 0.7, normal.y * 0.7 + 0.5, normal.z * 0.7),
      grav: -0.5,
    });
    this.decal(point, normal);
  }

  bloodBurst(point, dir) {
    if (!this.effectsOn) return;
    for (let i = 0; i < 5; i++) {
      this.puff(point, 'blood', {
        size0: 0.1 + Math.random() * 0.12, size1: 0.4, life: 0.35 + Math.random() * 0.25,
        vel: new THREE.Vector3(
          dir.x * 2.5 + (Math.random() - 0.5) * 2.5,
          dir.y * 1.5 + Math.random() * 1.8,
          dir.z * 2.5 + (Math.random() - 0.5) * 2.5),
        grav: 5.5,
      });
    }
  }

  puff(pos, kind, o = {}) {
    const p = this.puffs[this._puffI = (this._puffI + 1) % this.puffs.length];
    p.mesh.material = this.puffMats[kind] || this.puffMats.spark;
    p.mesh.position.copy(pos);
    p.mesh.visible = true;
    p.mesh.rotation.z = o.spin ?? Math.random() * Math.PI * 2;
    p.kind = kind;
    p.life = 0;
    p.max = o.life ?? 0.4;
    p.size0 = o.size0 ?? 0.3;
    p.size1 = o.size1 ?? 0.6;
    p.grav = o.grav ?? 0;
    if (o.vel) p.vel.copy(o.vel); else p.vel.set(0, 0, 0);
    p.mesh.scale.setScalar(p.size0);
    return p;
  }

  decal(point, normal) {
    const m = this.decals[this._decalI = (this._decalI + 1) % this.decals.length];
    _q.setFromUnitVectors(_up, normal);
    m.quaternion.copy(_q);
    m.position.copy(point).addScaledVector(normal, 0.012);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(0.6 + Math.random() * 0.7);
    m.visible = true;
  }

  update(dt, camera) {
    this.time += dt;

    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life += dt;
      if (t.life >= t.max) { t.mesh.visible = false; continue; }
      const k = 1 - t.life / t.max;
      t.mesh.material = this.tracerMat;
      t.mesh.scale.x = t.mesh.scale.y = k * 1.1;
    }

    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.mesh.visible = false; continue; }
      if (p.vel.lengthSq() > 0) {
        p.mesh.position.addScaledVector(p.vel, dt);
        p.vel.y -= p.grav * dt;
        p.vel.multiplyScalar(1 - Math.min(1, dt * 2.4));
      }
      const s = p.size0 + (p.size1 - p.size0) * k;
      p.mesh.scale.setScalar(s);
      if (camera) p.mesh.quaternion.copy(camera.quaternion);
      const m = p.mesh.material;
      // opacity is shared per-material; fade the flash pool by scale instead
      if (p.kind === 'smoke') m.opacity = 0.45 * (1 - k);
      else if (p.kind === 'blood') m.opacity = 1 - k * k;
    }

    if (this._flashT > 0) {
      this._flashT -= dt;
      this.flashLight.intensity *= Math.max(0, 1 - dt * 26);
      if (this._flashT <= 0) this.flashLight.intensity = 0;
    }
  }

  clearDecals() {
    for (const d of this.decals) d.visible = false;
    for (const p of this.puffs) p.mesh.visible = false;
    for (const t of this.tracers) t.mesh.visible = false;
  }
}
