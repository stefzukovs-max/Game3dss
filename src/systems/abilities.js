import * as THREE from 'three';
import { now, clamp } from '../core/utils.js';
import { audio } from '../core/audio.js';

/**
 * Operator actives, throwables and the things they leave behind
 * (fire pools, deployable cover, dropped kits).
 *
 * Everything here is a small object with an `update(dt)` and a `dead` flag;
 * the system sweeps the list each frame.
 */

const GRAV = 17;

export class AbilitySystem {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.deployables = [];
    this.fires = [];
    this.markers = [];
    this.revealUntil = 0;

    const s = game.scene;
    this.grenadeGeo = new THREE.SphereGeometry(0.1, 8, 6);
    this.grenadeMat = new THREE.MeshLambertMaterial({ color: 0x2e3428 });
    this.bottleMat = new THREE.MeshLambertMaterial({ color: 0x6f8f4a });
    this.flashMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
    this.fireMat = new THREE.MeshBasicMaterial({
      map: game.world.tex.spark, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, color: 0xff8a2b,
    });
    this.scene = s;
  }

  /* ══════════════ operator actives ══════════════ */
  canUse(actor) {
    return actor.alive && actor.abilityCd <= 0;
  }

  activate(actor) {
    if (!this.canUse(actor)) return false;
    const ab = actor.char.ability;
    const cd = ab.cooldown * (actor.upgrades?.cooldown ? 1 / actor.upgrades.cooldown : 1);

    switch (ab.id) {
      case 'reveal':
      case 'drone':
      case 'thermal':
        this.revealUntil = Math.max(this.revealUntil, now() + ab.duration);
        actor.abilityActive = ab.duration;
        audio.tone(880, 0.14, 0.2, 'triangle');
        audio.tone(1320, 0.2, 0.16, 'triangle', 0.1);
        this.game.hud.banner(ab.name.toUpperCase(), 'hostiles marked');
        break;

      case 'focus':
        actor.abilityActive = ab.duration;
        audio.tone(440, 0.3, 0.14, 'sine');
        this.game.hud.banner('STEADY', 'hold your breath');
        break;

      case 'barricade':
        if (!this._deployCover(actor)) return false;
        break;

      case 'medkit':
        this._dropKit(actor);
        break;

      case 'molotov':
        this.throwProjectile(actor, 'molotov');
        break;

      case 'flash':
        this.throwProjectile(actor, 'flash');
        break;

      case 'surge': {
        const dur = ab.duration;
        const until = now() + dur;
        const apply = (a) => {
          a.buffs.damage = 1.0; a.buffs.fireRate = 1.25; a.buffs.speed = 1.25; a.buffs.until = until;
        };
        apply(actor);
        for (const a of this.game.agents) {
          if (a.alive && a.faction === actor.faction && a.pos.distanceTo(actor.pos) < (ab.radius || 20)) apply(a);
        }
        audio.tone(392, 0.2, 0.2, 'sawtooth');
        audio.tone(523, 0.3, 0.18, 'sawtooth', 0.12);
        this.game.hud.banner('PUSH UP', 'squad surging');
        break;
      }
      default:
        return false;
    }

    actor.abilityCd = cd;
    return true;
  }

  _deployCover(actor) {
    const yaw = actor.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const x = actor.pos.x + fx * 1.7;
    const z = actor.pos.z + fz * 1.7;
    const g = this.game.world.collision.groundHeight(x, z, actor.pos.y + 1.2, 0.6);
    if (g < actor.pos.y - 2) return false;

    const w = 3.0, h = 1.25, d = 0.42;
    const isCop = actor.faction === 'police';
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color: isCop ? 0x2a3346 : 0x7a6a52 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(x, g + h / 2, z);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);

    // legs / detailing so it doesn't read as a floating slab
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.5), mat);
    leg.position.set(-w / 2 + 0.2, -h / 2 + 0.05, 0.2);
    mesh.add(leg);
    const leg2 = leg.clone();
    leg2.position.x = w / 2 - 0.2;
    mesh.add(leg2);

    const cos = Math.abs(Math.cos(yaw)), sin = Math.abs(Math.sin(yaw));
    const box = this.game.world.collision.addLive(
      x, g + h / 2, z, w * cos + d * sin, h, w * sin + d * cos, 'deployable');

    const dur = actor.char.ability.duration;
    this.deployables.push({
      mesh, box, life: dur, max: dur, dead: false,
      update(dt) {
        this.life -= dt;
        if (this.life < 1.5) this.mesh.visible = Math.floor(this.life * 8) % 2 === 0;
        if (this.life <= 0) this.dead = true;
      },
    });
    audio.click(actor.pos, 320, 0.4, 0.16);
    return true;
  }

  _dropKit(actor) {
    const g = this.game.world.collision.groundHeight(actor.pos.x, actor.pos.z, actor.pos.y + 1, 0.5);
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.42, 0.42),
      new THREE.MeshLambertMaterial({ color: 0xe8e2d4 }));
    grp.add(body);
    const crossMat = new THREE.MeshLambertMaterial({ color: 0xd23b3b, emissive: 0x400808 });
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.03), crossMat);
    a.position.z = 0.22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.03), crossMat);
    b.position.z = 0.22;
    grp.add(a, b);
    grp.position.set(actor.pos.x, g + 0.22, actor.pos.z);
    grp.castShadow = true;
    this.scene.add(grp);

    const dur = actor.char.ability.duration;
    const game = this.game;
    this.deployables.push({
      mesh: grp, box: null, life: dur, dead: false, tick: 0,
      update(dt) {
        this.life -= dt;
        this.mesh.rotation.y += dt * 0.9;
        this.tick -= dt;
        if (this.tick <= 0) {
          this.tick = 0.5;
          const heal = (u) => {
            if (!u.alive || u.faction !== actor.faction) return;
            if (u.pos.distanceTo(this.mesh.position) > 3.6) return;
            if (u.heal) u.heal(7); else u.health = Math.min(u.maxHealth, u.health + 7);
            if (u.addArmor) u.addArmor(3);
            if (u === game.player) {
              for (const w of Object.values(u.weapons)) w.addAmmo(Math.ceil(w.def.mag * 0.35));
            }
          };
          heal(game.player);
          for (const ag of game.agents) heal(ag);
        }
        if (this.life <= 0) this.dead = true;
      },
    });
    audio.pickup();
  }

  /* ══════════════ throwables ══════════════ */
  throwGrenade(actor) {
    if (actor.grenades <= 0) return false;
    actor.grenades--;
    this.throwProjectile(actor, 'frag');
    return true;
  }

  throwProjectile(actor, kind) {
    const isPlayer = !!actor.isPlayer;
    const origin = new THREE.Vector3(actor.pos.x, actor.pos.y + 1.5, actor.pos.z);
    let dir;
    if (isPlayer) {
      dir = this.game.camera.getWorldDirection(new THREE.Vector3());
    } else {
      dir = new THREE.Vector3(-Math.sin(actor.yaw), 0.28, -Math.cos(actor.yaw)).normalize();
    }
    origin.addScaledVector(dir, 0.6);

    const power = kind === 'molotov' ? 17 : 19;
    const vel = dir.clone().multiplyScalar(power);
    vel.y += 3.4;

    const mesh = new THREE.Mesh(
      kind === 'molotov' ? new THREE.BoxGeometry(0.12, 0.26, 0.12) : this.grenadeGeo,
      kind === 'molotov' ? this.bottleMat : kind === 'flash' ? this.flashMat : this.grenadeMat);
    mesh.castShadow = true;
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const fuse = kind === 'frag'
      ? (actor.char?.passive.id === 'pyro' ? 1.8 : 2.5)
      : 99; // molotov & flash trigger on impact / short timer

    this.projectiles.push({
      mesh, kind, owner: actor, faction: actor.faction,
      vel, fuse, life: 0, bounces: 0, dead: false, impacted: false,
    });
    audio.click(actor.pos, 600, 0.25, 0.06);
  }

  /* ══════════════ per-frame ══════════════ */
  update(dt) {
    const col = this.game.world.collision;

    // ── projectiles ──
    for (const p of this.projectiles) {
      p.life += dt;
      p.vel.y -= GRAV * dt;

      const step = _v.copy(p.vel).multiplyScalar(dt);
      const dist = step.length();
      if (dist > 1e-4) {
        const dir = _v2.copy(step).multiplyScalar(1 / dist);
        const hit = col.raycast(p.mesh.position, dir, dist + 0.09, _hit);
        if (hit) {
          p.mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.06);
          if (p.kind === 'molotov' || p.kind === 'flash') {
            p.fuse = p.kind === 'flash' ? Math.min(p.fuse, 0.35) : 0;
            p.impacted = true;
            if (p.kind === 'molotov') { p.fuse = 0; }
          }
          const n = hit.normal;
          const d = p.vel.dot(n);
          p.vel.addScaledVector(n, -2 * d).multiplyScalar(0.42);
          p.bounces++;
          if (p.vel.lengthSq() < 0.6) p.vel.set(0, 0, 0);
          if (p.bounces === 1 && p.kind === 'frag') audio.impact(p.mesh.position, 'metal');
        } else {
          p.mesh.position.add(step);
        }
      }
      p.mesh.rotation.x += dt * 7;
      p.mesh.rotation.z += dt * 5;

      p.fuse -= dt;
      if (p.fuse <= 0) {
        this._detonate(p);
        p.dead = true;
      } else if (p.life > 12) {
        p.dead = true;
      }
    }
    this._sweep(this.projectiles, (p) => this.scene.remove(p.mesh));

    // ── deployables ──
    for (const d of this.deployables) d.update(dt);
    this._sweep(this.deployables, (d) => {
      this.scene.remove(d.mesh);
      if (d.box) this.game.world.collision.removeLive(d.box);
    });

    // ── fire pools ──
    for (const f of this.fires) {
      f.life -= dt;
      f.tick -= dt;
      f.anim += dt;
      for (let i = 0; i < f.sprites.length; i++) {
        const s = f.sprites[i];
        const ph = f.anim * 3 + i;
        s.position.y = f.y + 0.35 + Math.sin(ph) * 0.28 + (i % 3) * 0.12;
        s.scale.setScalar((0.9 + Math.sin(ph * 1.7) * 0.3) * f.scale * clamp(f.life / 1.5, 0.15, 1));
        if (this.game.camera) s.quaternion.copy(this.game.camera.quaternion);
      }
      f.light.intensity = (2.6 + Math.sin(f.anim * 11) * 0.9) * clamp(f.life / 1.5, 0, 1);
      if (f.tick <= 0) {
        f.tick = 0.35;
        this._burnZone(f);
      }
      if (f.life <= 0) f.dead = true;
    }
    this._sweep(this.fires, (f) => {
      for (const s of f.sprites) this.scene.remove(s);
      this.scene.remove(f.light);
    });

    if (this.revealUntil > 0 && now() > this.revealUntil) this.revealUntil = 0;
  }

  _sweep(list, onRemove) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].dead) { onRemove(list[i]); list.splice(i, 1); }
    }
  }

  /* ── detonation ── */
  _detonate(p) {
    const pos = p.mesh.position;
    const game = this.game;

    if (p.kind === 'frag') {
      const radius = 7.5;
      const mul = p.owner?.char?.passive.id === 'pyro' ? 1.35 : 1;
      game.combat.puff(pos, 'flash', { size0: 3.4, size1: 6.5, life: 0.2 });
      for (let i = 0; i < 12; i++) {
        game.combat.puff(pos, 'spark', {
          size0: 0.25, size1: 0.03, life: 0.3 + Math.random() * 0.3,
          vel: new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 10, (Math.random() - 0.5) * 16),
          grav: 9,
        });
      }
      game.combat.puff(pos, 'smoke', { size0: 1.2, size1: 6, life: 1.6, vel: new THREE.Vector3(0, 1.4, 0), grav: -0.5 });
      audio.gunshot(pos, { size: 2.6 });
      game.shake(pos, 1.5, 26);

      for (const u of game.allUnits()) {
        if (!u.alive) continue;
        const d = u.pos.distanceTo(pos);
        if (d > radius) continue;
        const centre = _v.set(u.pos.x, u.pos.y + 1.0, u.pos.z);
        if (game.world.collision.losBlocked(pos, centre)) continue;
        const falloff = 1 - d / radius;
        const dmg = 110 * falloff * falloff * mul;
        if (u.faction === p.faction && u !== p.owner) continue; // no team damage
        game.applyDamage(u, dmg, p.owner, 'body', centre);
        if (u.stagger !== undefined) u.stagger = 0.6;
      }
    } else if (p.kind === 'molotov') {
      const g = game.world.collision.groundHeight(pos.x, pos.z, pos.y + 1.5, 0.6);
      this._spawnFire(pos.x, Math.max(g, pos.y - 1.5), pos.z, p.owner, 9);
      audio.impact(pos, 'wood');
      game.combat.puff(pos, 'flash', { size0: 1.6, size1: 3.4, life: 0.3 });
    } else if (p.kind === 'flash') {
      game.combat.puff(pos, 'flash', { size0: 5, size1: 11, life: 0.35 });
      audio.gunshot(pos, { size: 1.6 });
      for (const u of game.allUnits()) {
        if (!u.alive || u.faction === p.faction) continue;
        const d = u.pos.distanceTo(pos);
        if (d > 18) continue;
        const centre = _v.set(u.pos.x, u.pos.y + 1.4, u.pos.z);
        if (game.world.collision.losBlocked(pos, centre)) continue;
        if (u.char?.passive.id === 'hardened') continue;
        // facing matters: looking away costs you much less
        let facing = 1;
        const toB = _v2.subVectors(pos, u.pos).normalize();
        const fwd = _v3.set(-Math.sin(u.yaw), 0, -Math.cos(u.yaw));
        facing = clamp((toB.dot(fwd) + 0.4) / 1.4, 0.15, 1);
        const t = 4 * facing * (1 - d / 24);
        u.flashed = Math.max(u.flashed || 0, t);
        if (u.isPlayer) game.hud.flash(t);
      }
    }
  }

  _spawnFire(x, y, z, owner, duration) {
    const sprites = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.9), this.fireMat);
      const a = (i / 10) * Math.PI * 2;
      const r = Math.random() * 1.7;
      s.position.set(x + Math.cos(a) * r, y + 0.4, z + Math.sin(a) * r);
      s.frustumCulled = false;
      this.scene.add(s);
      sprites.push(s);
    }
    const light = new THREE.PointLight(0xff7a2b, 3, 14, 2);
    light.position.set(x, y + 1.1, z);
    this.scene.add(light);

    this.fires.push({
      x, y, z, owner, faction: owner?.faction, sprites, light,
      life: duration, tick: 0, anim: 0, scale: 1, radius: 2.6, dead: false,
    });
  }

  _burnZone(f) {
    for (const u of this.game.allUnits()) {
      if (!u.alive || u.faction === f.faction) continue;
      const dx = u.pos.x - f.x, dz = u.pos.z - f.z;
      if (dx * dx + dz * dz > f.radius * f.radius) continue;
      if (Math.abs(u.pos.y - f.y) > 3) continue;
      u.burning = Math.max(u.burning || 0, 2.2);
      u._burnSource = f.owner;
      if (u.isPlayer) this.game.hud.flashDamage();
    }
  }

  clear() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const d of this.deployables) {
      this.scene.remove(d.mesh);
      if (d.box) this.game.world.collision.removeLive(d.box);
    }
    for (const f of this.fires) {
      for (const s of f.sprites) this.scene.remove(s);
      this.scene.remove(f.light);
    }
    this.projectiles.length = 0;
    this.deployables.length = 0;
    this.fires.length = 0;
    this.revealUntil = 0;
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _hit = {};
