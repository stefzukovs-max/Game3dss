import * as THREE from 'three';
import { clamp, damp, lerp, now, angleDelta } from '../core/utils.js';
import { CharacterModel, makeOutfit } from './character.js';
import { SkinnedActor, actorsReady } from './actor.js';

/**
 * Build whichever body is available.
 *
 * The rigged pack is optional, so this is the one place that knows which rig
 * the game is running. Both implement the same interface, so nothing below
 * this line changes.
 */
const makeCharacter = (outfit) =>
  (actorsReady() ? new SkinnedActor(outfit) : new CharacterModel(outfit));
import { WEAPONS, WeaponState, attachWeapon } from '../systems/weapons.js';
import { audio } from '../core/audio.js';

const BASE_SPEED = 4.65;
const SPRINT_MUL = 1.62;
const CROUCH_MUL = 0.5;
const ADS_MUL = 0.56;
const AIR_CONTROL = 0.32;
const JUMP_V = 7.4;

/*
 * How long after leaving an edge a jump still counts, and how long before
 * landing one is remembered. Both in seconds. A tenth of a second is roughly
 * the size of a human timing error and is well under the threshold where a
 * player notices the game being generous.
 */
const COYOTE_TIME = 0.11;
const JUMP_BUFFER = 0.12;

/*
 * Landing. `LAND_DIP` is how far the camera drops on a hard landing, in
 * metres, and `LAND_RECOVER` how fast it comes back. The dip is what makes a
 * drop read as weight rather than as teleportation — the fall damage numbers
 * were already there, and the body arriving was not.
 */
const LAND_DIP = 0.085;
const LAND_RECOVER = 9;
const STAND_H = 1.82;
const CROUCH_H = 1.25;
const EYE = 1.62;

export class Player {
  constructor(game, char, faction) {
    this.game = game;
    this.char = char;               // roster entry
    this.faction = faction;
    this.isPlayer = true;
    this.team = faction;

    const s = char.stats;
    this.maxHealth = s.health;
    this.health = s.health;
    this.maxArmor = s.armor;
    this.armor = s.armor;
    this.speedMul = s.speed;
    this.control = s.control;

    // ── body ──
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = 0.4;
    this.height = STAND_H;
    this.standHeight = STAND_H;
    this.stepHeight = 0.45;
    this.onGround = false;
    this.crouching = false;
    this.sprinting = false;
    this.alive = true;

    // ── look ──
    this.yaw = Math.PI;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shoulder = 1;              // +1 right, -1 left
    this.camDist = 3.25;
    this.camDistCur = 3.25;
    this.aiming = false;
    this.aimBlend = 0;

    // ── combat ──
    this.weapons = {};
    for (const id of char.loadout) this.weapons[id] = new WeaponState(id);
    if (char.passive.id === 'logistics') {
      for (const w of Object.values(this.weapons)) {
        w.def = { ...w.def, maxReserve: Math.round(w.def.maxReserve * 1.6) };
        w.reserve = Math.round(w.reserve * 1.6);
      }
    }
    this.weaponId = char.loadout[0];
    this.grenades = char.grenades;
    this.maxGrenades = char.grenades;
    this.abilityCd = 0;
    this.abilityActive = 0;

    // ── state ──
    this.stamina = 100;
    this.staminaLock = 0;
    this.lastDamaged = -99;
    this.lastFired = -99;
    this.footTimer = 0;
    this.airTime = 0;
    this.fallStart = null;
    this.kills = 0;
    this.deaths = 0;
    this.headshots = 0;
    this.damageDealt = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.buffs = { damage: 1, fireRate: 1, speed: 1, until: 0 };
    this.upgrades = { damage: 1, health: 1, speed: 1, reload: 1, ammo: 1, cooldown: 1, armorRegen: 0, lifesteal: 0 };
    this.flashed = 0;
    this.burning = 0;

    // ── model: the roster character's signature silhouette ──
    const b = char.build;
    const outfit = makeOutfit(faction, 'elite');
    outfit.head = ['helmet', 'cap', 'bandana'].includes(b.headgear) ? b.headgear : 'none';
    outfit.frame = b.frame;
    outfit.helmet = outfit.helmet ?? 0x1a2130;
    outfit.capColor = outfit.capColor ?? (faction === 'police' ? 0x151c2b : 0xffd23f);
    outfit.bandana = outfit.bandana ?? 0xe11d48;
    if (b.frame === 'heavy' || faction === 'police') {
      outfit.vest = outfit.vest ?? 0x11151f;
      outfit.hasVest = true;
    }
    outfit.visor = b.extra === 'shield' || b.extra === 'breach';
    // operators get their own cached build so they never share a body with a grunt
    outfit.preset += ':op:' + char.id;
    this.model = makeCharacter(outfit);
    const frameK = b.frame === 'heavy' ? 1.06 : b.frame === 'light' ? 0.96 : 1;
    /*
     * `setSize` on a nullish-coalescing chain was a trap: it returns undefined,
     * so `a?.() ?? b()` runs BOTH and the fallback overwrote the correction.
     */
    if (this.model.setSize) this.model.setSize(frameK);
    else this.model.root.scale.setScalar(frameK);
    game.scene.add(this.model.root);
    attachWeapon(this.model, this.weaponId);
  }

  get weapon() { return this.weapons[this.weaponId]; }
  get eyeHeight() { return this.crouching ? CROUCH_H - 0.2 : EYE; }

  spawnAt(v) {
    this.pos.copy(v);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth * this.upgrades.health;
    this.armor = this.maxArmor;
    this.alive = true;
    this.model.deadBlend = 0;
    this.model.root.visible = true;
    this.stamina = 100;
    this.burning = 0;
    this.flashed = 0;
    for (const w of Object.values(this.weapons)) {
      w.mag = w.def.mag;
      w.reloading = false;
      w.reserve = Math.max(w.reserve, Math.floor(w.def.reserve * 0.6));
    }
  }

  /* ══════════════ per-frame ══════════════ */
  update(dt, input, world) {
    const t = now();
    if (!this.alive) {
      this.model.update(dt, { speed: 0, dead: true, aiming: false, crouching: false, pitch: 0 });
      return;
    }

    this._look(dt, input);
    this._move(dt, input, world);
    this._combat(dt, input, t);
    this._vitals(dt, t);

    this.model.setPosition(this.pos.x, this.pos.y, this.pos.z);
    this.model.root.rotation.y = this.yaw + Math.PI;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    /*
     * Velocity along the way the character is facing, so the animation can tell
     * walking forwards from backing away. At yaw 0 forward is -Z, which is what
     * `rotation.y = yaw + PI` turns a +Z-facing model to.
     */
    const fwd = this.vel.x * -Math.sin(this.yaw) + this.vel.z * -Math.cos(this.yaw);
    this.model.update(dt, {
      speed: hs, aiming: this.aiming, crouching: this.crouching,
      pitch: this.pitch, dead: false, lean: this._strafe, fwd,
    });
  }

  _look(dt, input) {
    const d = input.takeLook();
    const adsScale = this.aiming ? 0.55 : 1;
    this.yaw -= d.x * adsScale;
    this.pitch = clamp(this.pitch - d.y * adsScale, -1.35, 1.28);

    // recoil settles back down
    const rec = 9 * this.control * this.upgrades.reload;
    this.recoilPitch = damp(this.recoilPitch, 0, rec, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, rec, dt);

    if (input.pressed('KeyQ')) this.shoulder *= -1;

    if (this.game.settings.assist && (this.aiming || input.firing)) {
      this._aimAssist(dt, input.isTouch);
    }
  }

  /**
   * Aim magnetism. Not a snap: it nudges the look angles toward a hostile
   * that is already close to the crosshair, and the nudge fades to nothing at
   * the edge of the cone. Touch gets roughly twice the pull of a mouse, since
   * a thumb can't make 1° corrections.
   */
  _aimAssist(dt, isTouch) {
    const game = this.game;
    const cone = isTouch ? 0.15 : 0.075;          // ~8.6° / ~4.3°
    const strength = isTouch ? 7.5 : 3.0;

    const cp = Math.cos(this.pitch);
    _f.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
    const eye = _p.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);

    let best = null, bestAng = cone;
    for (const a of game.agents) {
      if (!a.alive || a.faction === this.faction) continue;
      _d.set(a.pos.x - eye.x, a.pos.y + 1.2 - eye.y, a.pos.z - eye.z);
      const dist = _d.length();
      if (dist > 70 || dist < 1.5) continue;
      _d.multiplyScalar(1 / dist);
      const ang = Math.acos(clamp(_d.dot(_f), -1, 1));
      if (ang >= bestAng) continue;
      _c.set(a.pos.x, a.pos.y + 1.2, a.pos.z);
      if (game.world.collision.losBlocked(eye, _c)) continue;
      bestAng = ang;
      best = _a.copy(_d);
    }
    if (!best) return;

    const targetYaw = Math.atan2(-best.x, -best.z);
    const targetPitch = Math.asin(clamp(best.y, -1, 1));
    const falloff = 1 - bestAng / cone;           // no pull at the cone edge
    const k = 1 - Math.exp(-strength * falloff * dt);

    this.yaw += angleDelta(this.yaw, targetYaw) * k * 0.85;
    this.pitch += (targetPitch - this.pitch) * k * 0.85;
  }

  _move(dt, input, world) {
    const ax = input.moveAxis();
    this._strafe = ax.x;

    const wantCrouch = input.down('ControlLeft') || input.down('KeyC');
    const canStand = !world.collision.isBlocked(this.pos.x, this.pos.y, this.pos.z, this.radius, STAND_H);
    this.crouching = wantCrouch || (this.crouching && !canStand);
    this.height = this.crouching ? CROUCH_H : STAND_H;

    const wantSprint = input.down('ShiftLeft') && ax.y > 0.25 && !this.aiming
      && !this.crouching && this.stamina > 2;
    this.sprinting = wantSprint;

    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 17);
      this.staminaLock = 0.85;
    } else {
      this.staminaLock = Math.max(0, this.staminaLock - dt);
      if (this.staminaLock <= 0) this.stamina = Math.min(100, this.stamina + dt * 24);
    }

    let speed = BASE_SPEED * this.speedMul * this.upgrades.speed * this.buffs.speed;
    if (this.sprinting) speed *= SPRINT_MUL;
    else if (this.crouching) speed *= CROUCH_MUL;
    if (this.aiming) speed *= ADS_MUL + (this.weapon?.def.aimMul ?? 0.6) * 0.35;
    if (this.burning > 0) speed *= 0.85;

    // camera-relative movement
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = ax.x * cos - ax.y * sin;
    const wishZ = -ax.x * sin - ax.y * cos;

    const accel = this.onGround ? 42 : 42 * AIR_CONTROL;
    const targetVX = wishX * speed, targetVZ = wishZ * speed;
    this.vel.x = damp(this.vel.x, targetVX, accel / Math.max(1, speed), dt);
    this.vel.z = damp(this.vel.z, targetVZ, accel / Math.max(1, speed), dt);
    if (this.onGround && ax.x === 0 && ax.y === 0) {
      this.vel.x = damp(this.vel.x, 0, 16, dt);
      this.vel.z = damp(this.vel.z, 0, 16, dt);
    }

    /*
     * ── jumping, with the two forgivenesses every platformer has ──
     *
     * This map is nine hundred concrete steps, low walls and rooftops, so the
     * player is at an edge more or less constantly and a jump that does not
     * come out reads as the game being broken rather than as the player being
     * late.
     *
     *   COYOTE   you may still jump for a moment after walking off an edge.
     *            Nobody has ever pressed jump on the exact frame they left
     *            the floor, and without this a run off a step becomes a fall.
     *
     *   BUFFER   a jump pressed just before landing fires on landing rather
     *            than being dropped. This is what makes repeated hops down a
     *            staircase feel continuous instead of stuttering.
     *
     * Both are short enough to be invisible and long enough to matter — a
     * tenth of a second is about two frames' worth of human timing error.
     */
    const jumpMul = this.char.passive.id === 'rooftops' ? 1.4 : 1;
    if (this.onGround) this._coyote = COYOTE_TIME;
    else this._coyote = Math.max(0, (this._coyote ?? 0) - dt);
    if (input.pressed('Space')) this._jumpBuffer = JUMP_BUFFER;
    else this._jumpBuffer = Math.max(0, (this._jumpBuffer ?? 0) - dt);

    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vel.y = JUMP_V * Math.sqrt(jumpMul);
      this.onGround = false;
      this._jumpBuffer = 0;
      this._coyote = 0;
      audio.footstep(this.pos, true);
    }

    const wasAir = !this.onGround;
    const prevY = this.pos.y;
    world.collision.moveBody(this, dt);

    // fall damage
    if (!this.onGround) {
      if (this.vel.y < -1) this.fallStart = Math.max(this.fallStart ?? prevY, prevY);
      this.airTime += dt;
    } else {
      if (wasAir && this.fallStart != null) {
        const drop = this.fallStart - this.pos.y;
        const free = this.char.passive.id === 'rooftops' ? 9.5 : 6.5;
        /*
         * Arriving. The camera dips on landing, scaled by the drop and capped
         * so that stepping off a kerb is a twitch and coming off a roof is a
         * proper knee bend. Fall *damage* already existed; the body having
         * weight when it lands did not, and one number told the player they
         * had fallen while their eyes said they had teleported.
         */
        this.landDip = Math.min(1, drop / 5) * LAND_DIP;
        if (drop > free) this.damage((drop - free) * 8.5, null, 'the fall');
        if (drop > 1.5) audio.footstep(this.pos, true);
      }
      this.fallStart = null;
      this.airTime = 0;
    }

    // footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 1) {
      this.footTimer -= dt * hs;
      if (this.footTimer <= 0) {
        this.footTimer = this.sprinting ? 3.2 : 4.2;
        if (this.char.passive.id !== 'rooftops') audio.footstep(this.pos, this.sprinting);
      }
    }

    // keep inside the map
    this.pos.x = clamp(this.pos.x, world.bounds.x0, world.bounds.x1);
    this.pos.z = clamp(this.pos.z, world.bounds.z0, world.bounds.z1);
  }

  _combat(dt, input, t) {
    const w = this.weapon;
    if (!w) return;

    // ── aim ──
    const focusing = this.abilityActive > 0 && this.char.ability.id === 'focus';
    this.aiming = (input.aiming || focusing) && !this.sprinting;
    this.aimBlend = damp(this.aimBlend, this.aiming ? 1 : 0,
      this.char.passive.id === 'doorDown' ? 20 : 14, dt);

    w.decayBloom(dt * this.control);

    // ── weapon switching ──
    for (const id of Object.keys(this.weapons)) {
      const slot = WEAPONS[id].slot;
      if (input.pressed('Digit' + slot)) this.switchTo(id);
    }
    const wheel = input.takeWheel();
    if (wheel !== 0 || input.pressed('KeyX')) {
      const ids = Object.keys(this.weapons);
      const i = ids.indexOf(this.weaponId);
      this.switchTo(ids[(i + (wheel > 0 ? 1 : ids.length - 1) + (input.pressed('KeyX') ? 1 : 0)) % ids.length]);
    }

    // ── reload ──
    if (input.pressed('KeyR') && w.canReload) this.startReload();
    if (w.reloading) {
      if (t >= w.reloadEnd) this.finishReload();
    } else if (w.mag <= 0 && w.reserve > 0) {
      this.startReload();
    }

    // ── fire ──
    const def = w.def;
    const canFire = this.alive && !w.reloading && !this.sprinting && t >= w.nextShot && this.flashed <= 0;

    if (input.firing && canFire && w.mag > 0 && (def.auto || !this._semiLatch)) {
      this.fire(t);
      if (!def.auto) this._semiLatch = true;
    }
    if (!input.firing) {
      this._semiLatch = false;
      /*
       * A quarter of a second off the trigger is a new burst, and the recoil
       * pattern starts again from the top. Without this the pattern belongs to
       * the magazine rather than to the burst, and tapping single shots would
       * climb the same curve as holding the trigger down — which would punish
       * exactly the trigger discipline the pattern is there to reward.
       */
      if (t - this.lastFired > 0.25) w.resetPattern();
    }

    if (input.firing && w.mag <= 0 && !w.reloading && t >= w.nextShot) {
      w.nextShot = t + 0.35;
      audio.click(this.pos, 400, 0.3);
      if (w.reserve > 0) this.startReload();
    }
  }

  switchTo(id) {
    if (!id || !this.weapons[id] || id === this.weaponId) return;
    const w = this.weapon;
    if (w) w.reloading = false;
    this.weaponId = id;
    attachWeapon(this.model, id);
    audio.click(this.pos, 1100, 0.25);
  }

  startReload() {
    const w = this.weapon;
    if (!w.canReload) return;
    w.reloading = true;
    w.resetPattern();                  // a fresh magazine starts the burst over
    w.reloadStart = now();
    const mul = this.char.passive.id === 'command' ? 0.8 : 1;
    w.reloadEnd = w.reloadStart + w.def.reload * mul / this.upgrades.reload;
    audio.reload(this.pos);
  }

  finishReload() {
    const w = this.weapon;
    w.reloading = false;
    if (w.def.shellReload) {
      // pump guns top up one shell at a time; keep going while the mag isn't full
      const n = Math.min(1, w.reserve, w.def.mag - w.mag);
      w.mag += n; w.reserve -= n;
      if (w.mag < w.def.mag && w.reserve > 0) this.startReload();
    } else {
      const n = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += n; w.reserve -= n;
    }
  }

  /** Where the shot comes from visually. */
  muzzleWorld(out = new THREE.Vector3()) {
    if (this.model.muzzleNode) return this.model.muzzleNode.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  fire(t) {
    const w = this.weapon;
    const def = w.def;
    const game = this.game;

    w.mag--;
    w.nextShot = t + 60 / (def.rpm * this.buffs.fireRate);
    this.lastFired = t;

    const cam = game.camera;
    const origin = _o.copy(cam.position);
    const dir = cam.getWorldDirection(_d).clone();

    const hs = Math.hypot(this.vel.x, this.vel.z);
    let spread = w.spread(this.aiming, hs, this.crouching);

    // Queen: crouched ADS is pinpoint
    if (this.char.passive.id === 'breathControl' && this.aiming && this.crouching) spread *= 0.05;
    if (this.abilityActive > 0 && this.char.ability.id === 'focus') spread = 0;

    const muzzle = this.muzzleWorld(_mz);
    const hits = game.combat.fire(this, origin, dir, w, game.livingTargets(this), { spread, muzzle });

    w.addBloom();
    // the shooter's own recoil, so firing reads from outside as well as from
    // behind the camera; the procedural rig has no such method, hence the guard
    this.model.kick?.(def.recoil);

    /*
     * Recoil, from the weapon's pattern rather than from a random number.
     *
     * `recoilPitch` is the part that snaps back on its own — the visual kick.
     * `pitch`/`yaw` is the part that stays until the player corrects it, which
     * is what makes pulling down a skill. Both come off the same pattern, so
     * the burst walks the same way every magazine and can be learned.
     */
    const pat = w.pattern();
    const soft = 1 / this.control * (this.aiming ? 0.62 : 1) * (this.crouching ? 0.8 : 1);
    const kick = pat.up * soft;
    this.recoilPitch += kick * 0.011;
    this.pitch += kick * 0.009;
    this.recoilYaw += pat.side * soft * 0.010;
    this.yaw += pat.side * soft * 0.006;
    w.shotIndex++;
    game.camera.userData.shake = Math.min(1, (game.camera.userData.shake || 0) + kick * 0.09);

    // damage bonuses
    let mul = this.upgrades.damage * this.buffs.damage;
    if (this.char.passive.id === 'coldBlood' && this.aiming && hs < 0.4) mul *= 1.45;
    if (this.abilityActive > 0 && this.char.ability.id === 'focus') mul *= 1.35;

    for (const h of hits) {
      let dmg = h.damage * mul;
      if (this.char.passive.id === 'doorDown' && h.dist < 8) dmg *= 1.35;
      if (this.char.passive.id === 'breathControl' && h.zone === 'head') dmg *= 1.3;
      game.applyDamage(h.target, dmg, this, h.zone, h.point);
    }
    if (hits.length) game.onPlayerHit(hits);
    game.hud.onShot(this);
  }

  /* ══════════════ damage ══════════════ */
  damage(amount, from, cause) {
    if (!this.alive) return 0;
    let dmg = amount;

    if (this.char.passive.id === 'thickHide') dmg *= 0.75;
    if (this.char.passive.id === 'hardened' && from) {
      // frontal arc only
      _d.subVectors(from.pos ?? from, this.pos).normalize();
      const fwd = _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      if (_d.dot(fwd) > 0.25) dmg *= 0.7;
    }

    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.65);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.lastDamaged = now();
    audio.hurt();

    if (from && from.pos) this.game.hud.damageFrom(from.pos, this);
    if (this.health <= 0) {
      this.health = 0;
      this.die(from, cause);
    }
    return dmg;
  }

  heal(n) {
    this.health = Math.min(this.maxHealth * this.upgrades.health, this.health + n);
  }
  addArmor(n) { this.armor = Math.min(this.maxArmor || 50, this.armor + n); }

  die(from, cause) {
    if (!this.alive) return;
    this.alive = false;
    this.deaths++;
    this.streak = 0;
    this.vel.set(0, 0, 0);
    this.game.onPlayerDeath(from, cause);
  }

  _vitals(dt, t) {
    // out-of-combat regeneration
    const doc = this.char.passive.id === 'steadyHands';
    const delay = doc ? 3 : 6.5;
    const rate = doc ? 22 : 8;
    if (t - this.lastDamaged > delay && this.health > 0) {
      this.heal(rate * dt);
      if (this.upgrades.armorRegen > 0) this.addArmor(this.upgrades.armorRegen * dt);
    }

    if (this.burning > 0) {
      this.burning -= dt;
      this.damage(9 * dt, null, 'fire');
    }
    if (this.flashed > 0) this.flashed -= dt;
    if (this.abilityCd > 0) this.abilityCd -= dt;
    if (this.abilityActive > 0) this.abilityActive -= dt;
    if (this.buffs.until > 0 && t > this.buffs.until) {
      this.buffs.damage = 1; this.buffs.fireRate = 1; this.buffs.speed = 1; this.buffs.until = 0;
    }
  }

  /* ══════════════ third-person camera ══════════════ */
  updateCamera(camera, dt, collision) {
    const aim = this.aimBlend;

    /*
     * The camera pivot follows the player's head — damped vertically, exact
     * horizontally.
     *
     * The split matters. Horizontal lag makes aiming feel like steering a boat,
     * because the reticle sits on the camera and every strafe would swing it
     * off the target. Vertical lag costs nothing and fixes the thing that made
     * this hillside unpleasant to move around: the map is stairs, and every
     * step popped the eye height by a quarter of a metre in one frame, so
     * walking up the escadão strobed. Absorbing it over ~80 ms turns a stack of
     * steps into a ramp without touching where the shots go.
     *
     * Crouching is exempt on purpose — dropping into cover should read as a
     * fast, deliberate move, not a slow sink.
     */
    /*
     * The landing dip rides on top of the eye height rather than being damped
     * with it: it has to arrive in one frame to read as an impact, and then
     * recover slowly. Folding it into `camEyeY` before the damp would smear
     * the arrival across eighty milliseconds and lose the whole effect.
     */
    this.landDip = damp(this.landDip ?? 0, 0, LAND_RECOVER, dt);
    const eye = this.pos.y + lerp(this.eyeHeight, this.eyeHeight + 0.06, aim);
    if (this.camEyeY == null || Math.abs(eye - this.camEyeY) > 1.6) this.camEyeY = eye;
    else this.camEyeY = damp(this.camEyeY, eye, this.crouching !== this._camCrouch ? 26 : 13, dt);
    this._camCrouch = this.crouching;

    const pivot = _p.set(this.pos.x, this.camEyeY - this.landDip, this.pos.z);

    const pitch = clamp(this.pitch + this.recoilPitch, -1.35, 1.28);
    const yaw = this.yaw + this.recoilYaw;

    // desired offset behind the shoulder
    const dist = lerp(3.25, 1.45, aim) * (this.crouching ? 0.9 : 1);
    const side = lerp(0.62, 0.42, aim) * this.shoulder;
    const up = lerp(0.12, 0.06, aim);

    const fwd = _f.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
    const right = _r.set(Math.cos(yaw), 0, -Math.sin(yaw));

    const desired = _c.copy(pivot).addScaledVector(right, side).addScaledVector(fwd, -dist);
    desired.y += up;

    // pull the camera in if the wall is closer than the arm
    const armDir = _a.copy(desired).sub(pivot);
    const armLen = armDir.length();
    armDir.multiplyScalar(1 / Math.max(armLen, 1e-5));
    const hit = collision.raycast(pivot, armDir, armLen + 0.35, _hit);
    let allowed = armLen;
    if (hit) allowed = Math.max(0.35, hit.distance - 0.32);

    this.camDistCur = allowed < this.camDistCur
      ? allowed                                  // snap in instantly, never clip
      : damp(this.camDistCur, allowed, 9, dt);

    camera.position.copy(pivot).addScaledVector(armDir, this.camDistCur);

    // shake
    const sh = camera.userData.shake || 0;
    if (sh > 0.001) {
      camera.position.x += (Math.random() - 0.5) * sh * 0.13;
      camera.position.y += (Math.random() - 0.5) * sh * 0.13;
      camera.userData.shake = sh * Math.max(0, 1 - dt * 7);
    }

    camera.rotation.set(0, 0, 0);
    camera.rotateY(yaw);
    camera.rotateX(pitch);

    /*
     * Field of view carries three things at once: the zoom when you aim, the
     * squeeze when Focus is up, and a widening while sprinting. The last one is
     * the cheapest speed cue there is — nothing about the character changes, the
     * world just starts rushing past the edges of the screen — and without it a
     * sprint reads as the same run with a bigger number behind it.
     */
    const focus = this.abilityActive > 0 && this.char.ability.id === 'focus';
    const base = this.game.settings.fov + (this.sprinting ? 9 : 0);
    const targetFov = lerp(base, this.game.settings.fov - 22, aim) - (focus ? 14 : 0);
    // into the sprint quickly, out of it quickly, but ease into the aim
    camera.fov = damp(camera.fov, targetFov, aim > 0.02 ? 11 : 7, dt);
    camera.updateProjectionMatrix();
  }
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c = new THREE.Vector3();
const _a = new THREE.Vector3();
const _mz = new THREE.Vector3();
const _hit = {};
