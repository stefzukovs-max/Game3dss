import * as THREE from 'three';
import { clamp, damp, angleDelta, now, makeRNG } from '../core/utils.js';
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
import { WeaponState, attachWeapon, WEAPONS } from '../systems/weapons.js';
import { NavGraph } from '../world/navgraph.js';
import { audio } from '../core/audio.js';

/**
 * Combatant AI.
 *
 * Movement is waypoint-graph navigation between terraces, plus local steering
 * (obstacle whiskers + separation) once it's on the right terrace. Combat is a
 * reaction-time gate, burst discipline, and a skill-scaled aim error — the
 * things that make a shooter bot feel fair rather than either blind or lethal.
 */

const STATES = { ADVANCE: 'advance', ENGAGE: 'engage', COVER: 'cover', SEARCH: 'search', DEAD: 'dead' };

let UID = 1;

export class Agent {
  constructor(game, archetype, faction, spawn) {
    this.id = UID++;
    this.game = game;
    this.faction = faction;
    this.team = faction;
    this.arch = archetype;
    this.isPlayer = false;

    const diffMul = game.difficultyMul;
    this.maxHealth = archetype.health * diffMul.health;
    this.health = this.maxHealth;
    this.maxArmor = archetype.armor * diffMul.health;
    this.armor = this.maxArmor;
    this.skill = clamp(archetype.skill * diffMul.skill, 0.1, 0.97);
    this.scoreValue = archetype.score;

    // body
    this.pos = new THREE.Vector3().copy(spawn);
    this.vel = new THREE.Vector3();
    this.radius = 0.42;
    this.standHeight = 1.82;
    this.height = 1.82;
    this.stepHeight = 0.45;
    this.onGround = false;
    this.crouching = false;
    this.alive = true;
    this.speedMul = archetype.speed;

    // combat
    this.weapon = new WeaponState(archetype.weapon, { reserve: 9999 });
    this.state = STATES.ADVANCE;
    this.target = null;
    this.lastSeen = new THREE.Vector3();
    this.hasLastSeen = false;
    this.visTimer = 0;
    this.reactUntil = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 0;
    this.repathTimer = 0;
    this.path = null;
    this.pathIdx = 0;
    this.stuckTimer = 0;
    this.lastPos = this.pos.clone();
    this.yaw = 0;
    this.pitch = 0;
    this.flashed = 0;
    this.burning = 0;
    this.stagger = 0;
    this.revealed = 0;
    this.deathTime = 0;
    this.coverPoint = null;
    this.coverTimer = 0;
    this.onClimb = false;
    this.buffs = { damage: 1, fireRate: 1, speed: 1, until: 0 };
    this.rng = makeRNG(this.id * 7919 + 13);

    // model - the bigger archetypes get a broader build, not just a bigger scale
    const outfit = makeOutfit(faction, archetype.rank, this.rng);
    outfit.frame = archetype.health >= 150 ? 'heavy' : 'normal';
    this.model = makeCharacter(outfit);
    this.model.root.scale.setScalar(archetype.rank === 'elite' ? 1.05 : 1);
    this.model.setPosition(spawn.x, spawn.y, spawn.z);
    game.scene.add(this.model.root);
    attachWeapon(this.model, archetype.weapon);

    this.nameTag = archetype.name;
  }

  get eye() { return this.pos.y + (this.crouching ? 1.05 : 1.55); }

  /* ══════════════ update ══════════════ */
  update(dt, game) {
    if (!this.alive) {
      this.deathTime += dt;
      this.model.update(dt, { speed: 0, dead: true, aiming: false, crouching: false, pitch: 0 });
      return;
    }

    const t = now();
    if (this.flashed > 0) this.flashed -= dt;
    if (this.burning > 0) {
      this.burning -= dt;
      this.takeDamage(11 * dt, this._burnSource, 'body', true);
      if (!this.alive) return;
    }
    if (this.stagger > 0) this.stagger -= dt;
    if (this.revealed > 0) this.revealed -= dt;
    if (this.buffs.until > 0 && t > this.buffs.until) {
      this.buffs.damage = 1; this.buffs.fireRate = 1; this.buffs.speed = 1; this.buffs.until = 0;
    }

    this._sense(dt, game, t);
    this._think(dt, game, t);
    this._steer(dt, game);
    this._shoot(dt, game, t);
    this._liveness(dt, game);

    this.weapon.decayBloom(dt);

    // animate
    this.model.setPosition(this.pos.x, this.pos.y, this.pos.z);
    this.model.faceYaw(this.yaw + Math.PI, dt, this.state === STATES.ENGAGE ? 13 : 7);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    // velocity along the facing, so backing off a target reverses the cycle
    // rather than moonwalking; see the note in actor.js
    const fwd = this.vel.x * -Math.sin(this.yaw) + this.vel.z * -Math.cos(this.yaw);
    this.model.update(dt, {
      speed: hs, aiming: this.state === STATES.ENGAGE && !!this.target,
      crouching: this.crouching, pitch: this.pitch, dead: false, fwd,
    });
  }

  /* ── perception ── */
  _sense(dt, game, t) {
    this.visTimer -= dt;
    if (this.visTimer > 0) return;
    this.visTimer = 0.16 + this.rng() * 0.12;

    const enemies = game.enemiesOf(this);
    let best = null, bestScore = Infinity;

    for (const e of enemies) {
      if (!e.alive) continue;
      const d = this.pos.distanceTo(e.pos);
      if (d > 92) continue;
      const eye = _a.set(this.pos.x, this.eye, this.pos.z);
      const tp = _b.set(e.pos.x, e.pos.y + 1.35, e.pos.z);
      if (game.world.collision.losBlocked(eye, tp)) continue;

      // prefer close, and heavily prefer whoever is shooting at us
      let score = d;
      if (e === this._lastAttacker) score *= 0.5;
      if (e.isPlayer) score *= 0.8;
      if (score < bestScore) { bestScore = score; best = e; }
    }

    if (best) {
      if (this.target !== best) {
        this.reactUntil = t + (0.55 - this.skill * 0.4) * (0.7 + this.rng() * 0.7);
      }
      this.target = best;
      this.lastSeen.copy(best.pos);
      this.hasLastSeen = true;
      this.visible = true;
    } else {
      this.visible = false;
      if (this.target && this.pos.distanceTo(this.lastSeen) < 3) {
        this.hasLastSeen = false;
        this.target = null;
      }
    }
  }

  /* ── decision ── */
  _think(dt, game, t) {
    const lowHp = this.health / this.maxHealth < 0.32;

    const was = this.state;

    if (this.visible && this.target) {
      const d = this.pos.distanceTo(this.target.pos);
      const wantCover = lowHp && this.rng() < 0.5;
      this.state = wantCover ? STATES.COVER : STATES.ENGAGE;
      // heavies close the distance, riflemen hold their range
      this.preferredRange = this.weapon.def.id === 'shotgun' ? 6
        : this.weapon.def.id === 'pistol' ? 12
        : this.weapon.def.id === 'smg' ? 14 : 22;
      this._engageDist = d;
    } else if (this.hasLastSeen) {
      this.state = STATES.SEARCH;
    } else {
      this.state = STATES.ADVANCE;
    }

    /*
     * Two of the six barks live here, on the state edge rather than in the
     * state, so they fire once when the thing happens instead of forty times
     * a second while it is true.
     */
    if (this.state !== was) {
      if (was !== STATES.ENGAGE && was !== STATES.COVER &&
          (this.state === STATES.ENGAGE || this.state === STATES.COVER)) {
        game.bark(this, 'contact');
      } else if (was === STATES.SEARCH && this.state === STATES.ADVANCE) {
        game.bark(this, 'push');   // lost him, moving up anyway
      }
    }

    if (this.state === STATES.COVER && (!this.coverPoint || this.coverTimer <= 0)) {
      this.coverPoint = this._findCover(game);
      this.coverTimer = 4;
    }
    this.coverTimer -= dt;

    // crouch behind cover or when shooting at range
    this.crouching = (this.state === STATES.COVER && this.coverPoint &&
      this.pos.distanceTo(this.coverPoint) < 1.6) ||
      (this.state === STATES.ENGAGE && this._engageDist > 26 && this.rng() < 0.02 ? true : this.crouching && this.state === STATES.ENGAGE);
    this.height = this.crouching ? 1.25 : 1.82;
  }

  _findCover(game) {
    if (!this.target) return null;
    const pts = game.world.meta.cover;
    let best = null, bestScore = Infinity;
    const tp = _b.set(this.target.pos.x, this.target.pos.y + 1.4, this.target.pos.z);
    for (let k = 0; k < 26; k++) {
      const p = pts[(Math.random() * pts.length) | 0];
      if (!p) break;
      const d = this.pos.distanceTo(p);
      if (d > 26) continue;
      _a.set(p.x, p.y + 1.4, p.z);
      if (!game.world.collision.losBlocked(_a, tp)) continue; // not actually cover
      const score = d;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /* ── movement ── */
  _steer(dt, game) {
    const speedBase = 4.6 * this.speedMul * this.buffs.speed * game.difficultyMul.speed;
    let speed = speedBase;
    let goal = null;
    let strafe = 0;
    let navigable = true;   // may this destination be routed through the graph?

    if (this.state === STATES.ENGAGE && this.target) {
      const d = this._engageDist;
      const to = _a.subVectors(this.target.pos, this.pos);
      to.y = 0;
      const dist = to.length() || 1;
      to.multiplyScalar(1 / dist);

      // hold preferred range
      let advance = 0;
      if (d > this.preferredRange * 1.25) advance = 1;
      else if (d < this.preferredRange * 0.6) advance = -0.8;

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 0.7 + this.rng() * 1.4;
        this.strafeDir *= this.rng() < 0.65 ? -1 : 1;
      }
      strafe = this.strafeDir * (0.55 + this.skill * 0.35);

      goal = _dest.copy(this.pos)
        .addScaledVector(to, advance * 4)
        .addScaledVector(_c.set(-to.z, 0, to.x), strafe * 4);
      speed *= 0.85;
      navigable = false;               // local footwork, not a cross-map trip
    } else if (this.state === STATES.COVER && this.coverPoint) {
      goal = _dest.copy(this.coverPoint);
      speed *= 1.05;
    } else if (this.state === STATES.SEARCH) {
      goal = _dest.copy(this.lastSeen);
      if (this.pos.distanceTo(this.lastSeen) < 2.5) this.hasLastSeen = false;
    } else {
      const obj = game.objectiveFor(this);
      goal = obj ? _dest.copy(obj) : null;
      speed *= 1.08;
    }

    if (!goal) { this._applyVelocity(dt, 0, 0, 0, game); return; }

    // Anything far away or on another terrace has to be routed through the
    // waypoint graph - walking straight at it just presses you into a
    // retaining wall for the rest of the match.
    if (navigable) {
      const flat = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
      if (flat > 11 || Math.abs(goal.y - this.pos.y) > 2.6) {
        const way = this._navGoal(dt, game, goal);
        if (way) goal = _g.copy(way);
      }
    }

    let dx = goal.x - this.pos.x;
    let dz = goal.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.35) { this._applyVelocity(dt, 0, 0, speed, game); return; }
    dx /= len; dz /= len;

    // ── obstacle avoidance ──
    // Recomputed a few times a second (it's the expensive part of the tick)
    // and reused in between as an angular offset on whatever we currently want.
    this._avoidTimer = (this._avoidTimer ?? 0) - dt;
    if (this._avoidTimer <= 0) {
      this._avoidTimer = 0.11 + this.rng() * 0.07;
      this._avoidAngle = 0;
      // Committed to a flight: hold the line. The only things beside you are
      // the railings, and stepping around them means leaving the stairs.
      const angles = this.onClimb
        ? [0.35, -0.35, 0.7, -0.7]
        : [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];
      if (!this._pathClear(game, dx, dz, this.onClimb ? 1.4 : 2.3)) {
        for (const ang of angles) {
          const c = Math.cos(ang), s2 = Math.sin(ang);
          if (this._pathClear(game, dx * c - dz * s2, dx * s2 + dz * c, this.onClimb ? 1.3 : 2.0)) {
            this._avoidAngle = ang;
            break;
          }
        }
        // Boxed in: commit to one side rather than juddering. On a flight we
        // hold the line first, but if that isn't working we still need a way out.
        if (this._avoidAngle === 0 && (!this.onClimb || this.stuckTimer > 0.8)) {
          this._avoidAngle = (this.rng() < 0.5 ? 1 : -1) * 1.9;
          this.path = null;
        }
      }
    }
    if (this._avoidAngle) {
      const c = Math.cos(this._avoidAngle), s2 = Math.sin(this._avoidAngle);
      const nx = dx * c - dz * s2, nz = dx * s2 + dz * c;
      dx = nx; dz = nz;
    }

    // ── separation from squadmates ──
    for (const o of game.agents) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 > 2.6 || d2 < 1e-5) continue;
      const d = Math.sqrt(d2);
      dx += (ox / d) * (1.6 - d) * 0.9;
      dz += (oz / d) * (1.6 - d) * 0.9;
    }
    const nl = Math.hypot(dx, dz) || 1;
    dx /= nl; dz /= nl;

    this._applyVelocity(dt, dx, dz, speed, game);
  }

  /**
   * March along a heading in short hops, carrying the ground height with us.
   * A ray can't tell a staircase from a wall; this can, because each hop only
   * has to be within step height of the last one.
   */
  _pathClear(game, dx, dz, dist) {
    const col = game.world.collision;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // Hop and radius are tuned against the map's tread depth (0.46 m): if the
    // probe steps too far, the tracked ground falls a whole riser behind the
    // real surface, and a few hops later the staircase reads as a wall.
    const hop = 0.3;
    const r = 0.28;
    const clear = this.stepHeight + 0.18; // a tread is not a wall
    let y = this.pos.y;
    for (let d = hop; d <= dist + 1e-6; d += hop) {
      const px = this.pos.x + dx * d, pz = this.pos.z + dz * d;
      const g = col.groundHeight(px, pz, y + this.stepHeight, r);
      if (g < y - 3.2) return false;                       // ledge we'd fall off
      if (col.isBlocked(px, g, pz, r, 1.55, clear)) return false;
      y = g;
    }
    return true;
  }

  _applyVelocity(dt, dx, dz, speed, game) {
    if (this.flashed > 0 || this.stagger > 0) speed *= 0.25;
    const tx = dx * speed, tz = dz * speed;
    this.vel.x = damp(this.vel.x, tx, 11, dt);
    this.vel.z = damp(this.vel.z, tz, 11, dt);

    const before = _c.copy(this.pos);
    game.world.collision.moveBody(this, dt);

    // unstick: if we've barely moved while trying to, hop or pick a new path
    const moved = before.distanceTo(this.pos);
    if (speed > 0.5 && moved < dt * 0.6) {
      this.stuckTimer += dt;
      // first try hopping - most snags are a kerb or a body in a doorway
      if (this.stuckTimer > 0.45 && this.onGround) {
        this.vel.y = 6.6;
        this.stuckTimer = 0.2;
        this._stuckStrikes = (this._stuckStrikes || 0) + 1;
        this._avoidTimer = 0;
      }
      // repeatedly snagged on the way to the same waypoint: give up on it,
      // skip ahead, and force a fresh route rather than grinding a wall
      if (this._stuckStrikes >= 3) {
        this._stuckStrikes = 0;
        this.stuckTimer = 0;
        if (this.path && this.pathIdx < this.path.length - 1) this.pathIdx++;
        else { this.path = null; this.repathTimer = 0; }
        this._avoidAngle = (this.rng() < 0.5 ? 1 : -1) * 1.6;
        this._avoidTimer = 0.8;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt);
      this._stuckDecay = (this._stuckDecay ?? 0) - dt;
      if (this._stuckDecay <= 0) { this._stuckDecay = 3; this._stuckStrikes = 0; }
    }

    // facing
    if (this.target && (this.state === STATES.ENGAGE || this.state === STATES.COVER)) {
      const yaw = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      this.yaw = this.yaw + angleDelta(this.yaw, yaw) * (1 - Math.exp(-11 * dt));
      const dy = (this.target.pos.y + 1.35) - this.eye;
      const flat = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      this.pitch = damp(this.pitch, Math.atan2(dy, flat), 9, dt);
    } else if (Math.hypot(this.vel.x, this.vel.z) > 0.4) {
      const yaw = Math.atan2(this.vel.x, this.vel.z);
      this.yaw = this.yaw + angleDelta(this.yaw, yaw) * (1 - Math.exp(-8 * dt));
      this.pitch = damp(this.pitch, 0, 5, dt);
    }
  }

  /**
   * Route toward `destination` through the waypoint graph and return the next
   * waypoint to steer at. Repaths on a timer, or immediately if the
   * destination has wandered away from the one we planned for.
   */
  _navGoal(dt, game, destination) {
    if (!destination) return null;
    this.repathTimer -= dt;

    // Repath rarely: recomputing every second makes agents dither between two
    // near-equal routes instead of walking either of them.
    const moved = !this._pathDest || this._pathDest.distanceToSquared(destination) > 64;
    const exhausted = !this.path || this.pathIdx >= this.path.length;
    if (this.repathTimer <= 0 || exhausted || moved) {
      this.repathTimer = 2.6 + Math.random() * 1.4;
      this._pathDest = (this._pathDest || new THREE.Vector3()).copy(destination);
      const nav = game.nav;
      const from = nav.nearest(this.pos, NavGraph.terraceOf(this.pos.z), destination);
      const to = nav.nearest(destination, NavGraph.terraceOf(destination.z));
      this.path = nav.path(from, to);
      this.pathIdx = 0;
      // skip the first node when we're already standing on it
      if (this.path && this.path.length > 1 &&
          nav.nodes[this.path[0]].pos.distanceTo(this.pos) < 5) this.pathIdx = 1;
    }

    if (!this.path || this.pathIdx >= this.path.length) { this.onClimb = false; return destination; }

    // advance through any waypoints we've already reached
    for (let guard = 0; guard < 6; guard++) {
      const node = game.nav.nodes[this.path[this.pathIdx]];
      this.onClimb = !!node.climb;
      const d = Math.hypot(node.pos.x - this.pos.x, node.pos.z - this.pos.z);
      // tighter capture on a flight, so we track the steps instead of the rail
      const capture = node.climb ? 2.4 : 3.4;
      if (d < capture && Math.abs(node.pos.y - this.pos.y) < 3.2) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) { this.onClimb = false; return destination; }
        continue;
      }
      return node.pos;
    }
    return destination;
  }

  /* ── shooting ── */
  _shoot(dt, game, t) {
    const w = this.weapon;
    if (w.reloading) {
      if (t >= w.reloadEnd) { w.reloading = false; w.mag = w.def.mag; }
      return;
    }
    if (!this.target || !this.visible || this.state === STATES.ADVANCE) return;
    if (t < this.reactUntil || this.flashed > 0) return;

    if (w.mag <= 0) {
      w.reloading = true;
      w.reloadEnd = t + w.def.reload * (1.5 - this.skill * 0.5);
      audio.reload(this.pos);
      this.game.bark(this, 'reload');
      return;
    }

    const d = this.pos.distanceTo(this.target.pos);
    if (d > w.def.range * 1.5) return;

    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    if (this.burstLeft <= 0) {
      this.burstLeft = w.def.auto
        ? Math.round(2 + this.skill * 6 + this.rng() * 3)
        : 1;
      this.burstPause = 0;
    }

    if (t < w.nextShot) return;

    const eye = _a.set(this.pos.x, this.eye, this.pos.z);
    const aim = _b.set(this.target.pos.x, this.target.pos.y + 1.3, this.target.pos.z);

    // lead a moving target a little, scaled by skill
    if (this.target.vel) {
      const lead = (d / 260) * this.skill * 2.2;
      aim.addScaledVector(this.target.vel, lead);
    }
    if (game.world.collision.losBlocked(eye, aim)) return;

    const dir = _c.subVectors(aim, eye).normalize();

    // accuracy: skill, distance, movement, difficulty
    const base = (1 - this.skill) * 0.075 + 0.004;
    const distPart = Math.min(1, d / 45) * 0.02 * (1 - this.skill);
    const movePart = Math.hypot(this.vel.x, this.vel.z) * 0.004;
    const spread = (base + distPart + movePart) * game.difficultyMul.spread;

    w.mag--;
    w.nextShot = t + 60 / (w.def.rpm * this.buffs.fireRate) * (1.25 - this.skill * 0.3);
    this.burstLeft--;
    if (this.burstLeft <= 0) this.burstPause = (0.75 - this.skill * 0.45) * (0.7 + this.rng() * 0.9);

    const muzzle = this.model.muzzleNode
      ? this.model.muzzleNode.getWorldPosition(_g) : eye;

    this.model.kick?.(w.def.recoil);
    const hits = game.combat.fire(this, eye, dir, w, game.enemiesOf(this),
      { spread, muzzle });

    for (const h of hits) {
      const dmg = h.damage * this.buffs.damage * game.difficultyMul.damage;
      game.applyDamage(h.target, dmg, this, h.zone, h.point);
    }
  }

  /**
   * Liveness guarantee.
   *
   * A wave only ends when every attacker is dead, so a single agent wedged in
   * some geometry pocket would stall the run forever. If one stops making
   * progress and nobody can see it, quietly redeploy it to a waypoint closer
   * to the objective and out of the player's line of sight. Never fires while
   * it's fighting or on screen.
   */
  _liveness(dt, game) {
    this._liveTimer = (this._liveTimer ?? 4) - dt;
    if (this._liveTimer > 0) return;
    this._liveTimer = 4;

    if (!this._livePos) { this._livePos = this.pos.clone(); return; }
    const moved = this._livePos.distanceTo(this.pos);
    this._livePos.copy(this.pos);

    if (moved > 3.5) { this._liveStrikes = 0; return; }
    if (this.state === STATES.ENGAGE || this.visible) return;

    this._liveStrikes = (this._liveStrikes || 0) + 1;
    if (this._liveStrikes < 2) {          // first strike: just try a new route
      this.path = null;
      this.repathTimer = 0;
      return;
    }
    this._liveStrikes = 0;
    this._redeploy(game);
  }

  _redeploy(game) {
    const obj = game.objectiveFor(this);
    const player = game.player;
    if (!obj || !player) return;
    const here = this.pos.distanceTo(obj);

    let best = null, bs = Infinity;
    for (const n of game.nav.nodes) {
      if (n.blocked) continue;
      const d = n.pos.distanceTo(obj);
      if (d > here - 6) continue;                       // must actually gain ground
      const dp = n.pos.distanceTo(player.pos);
      if (dp < 20 || dp > 75) continue;
      _a.set(n.pos.x, n.pos.y + 1.6, n.pos.z);
      _b.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
      if (!game.world.collision.losBlocked(_a, _b)) continue;   // don't pop into view
      if (d < bs) { bs = d; best = n; }
    }
    if (!best) return;

    this.pos.copy(best.pos);
    this.vel.set(0, 0, 0);
    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this._avoidAngle = 0;
    this.stuckTimer = 0;
    this._stuckStrikes = 0;
  }

  /* ── damage ── */
  takeDamage(amount, from, zone, silent) {
    if (!this.alive) return 0;
    let dmg = amount;
    if (this.armor > 0) {
      const a = Math.min(this.armor, dmg * 0.6);
      this.armor -= a;
      dmg -= a;
    }
    this.health -= dmg;
    this._lastAttacker = from;

    if (!silent) {
      this.model.flash();
      if (this.arch.rank !== 'elite' && Math.random() < 0.35) this.stagger = 0.28;
    }
    // being shot at from an unseen angle makes them look
    if (from && !this.visible) {
      this.lastSeen.copy(from.pos);
      this.hasLastSeen = true;
    }
    if (this.health <= 0) { this.health = 0; this.die(from); }
    return dmg;
  }

  die(from) {
    if (!this.alive) return;
    this.alive = false;
    this.deathTime = 0;
    this.vel.set(0, 0, 0);
    this.game.onAgentDeath(this, from);
  }

  dispose() {
    this.model.dispose();
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _g = new THREE.Vector3();
const _dest = new THREE.Vector3();
const _hit = {};
export { STATES };
