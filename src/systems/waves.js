import * as THREE from 'three';
import { Agent } from '../entities/ai.js';
import { GRUNTS } from '../entities/roster.js';
import { audio } from '../core/audio.js';

/**
 * Wave director.
 *
 * A wave is a points budget spent on archetypes; higher waves unlock the
 * expensive ones. Spawning is trickled in rather than dumped, and always
 * placed out of the player's sight so nobody pops into existence in front of
 * them. Every fifth wave is a named push with a heavier composition.
 */

const PHASE = { IDLE: 'idle', INTERMISSION: 'intermission', ACTIVE: 'active', DONE: 'done' };

export class WaveDirector {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.phase = PHASE.IDLE;
    this.timer = 0;
    this.queue = [];
    this.spawnTimer = 0;
    this.alliesWanted = 3;
    this.totalThisWave = 0;
    this.killedThisWave = 0;
  }

  get isBossWave() { return this.wave > 0 && this.wave % 5 === 0; }

  start() {
    this.wave = 0;
    this.phase = PHASE.INTERMISSION;
    this.timer = 6;
    this.game.hud.setWave(0, 'Get into position');
  }

  /** Budget and composition for a wave number. */
  planWave(n) {
    const enemyFaction = this.game.enemyFaction;
    const pool = GRUNTS[enemyFaction];
    const budget = Math.round(8 + n * 3.1 + Math.pow(n, 1.45) * 0.9);

    // unlock schedule keeps early waves readable
    const unlocked = pool.filter((_, i) =>
      i === 0 || (i === 1 && n >= 2) || (i === 2 && n >= 3) || (i === 3 && n >= 5) || (i === 4 && n >= 8));

    const cost = { grunt: 3, elite: 8 };
    const list = [];
    let spent = 0;
    let guard = 0;
    while (spent < budget && guard++ < 400) {
      // late waves lean elite
      const wantElite = n >= 5 && Math.random() < Math.min(0.42, 0.05 + n * 0.035);
      const candidates = unlocked.filter((a) => (a.rank === 'elite') === wantElite);
      const arch = (candidates.length ? candidates : unlocked)[
        (Math.random() * (candidates.length || unlocked.length)) | 0];
      list.push(arch);
      spent += cost[arch.rank];
    }

    if (this.isBossWave) {
      const boss = { ...pool[pool.length - 1] };
      boss.name = enemyFaction === 'police' ? 'Battalion Commander' : 'Hill Boss';
      boss.health *= 3.2;
      boss.armor *= 2.2;
      boss.skill = Math.min(0.95, boss.skill + 0.12);
      boss.score *= 4;
      boss.rank = 'elite';
      boss.isBoss = true;
      list.push(boss);
    }
    return list;
  }

  update(dt) {
    const game = this.game;

    if (this.phase === PHASE.INTERMISSION) {
      this.timer -= dt;
      game.hud.setIntermission(Math.max(0, this.timer));
      if (this.timer <= 0) this.beginWave();
      this._topUpAllies(dt);
      return;
    }

    if (this.phase !== PHASE.ACTIVE) return;

    // trickle spawns
    if (this.queue.length) {
      this.spawnTimer -= dt;
      const alive = game.agents.filter((a) => a.alive && a.faction === game.enemyFaction).length;
      const cap = Math.min(game.maxEnemies ?? 18, 7 + Math.floor(this.wave * 0.8));
      if (this.spawnTimer <= 0 && alive < cap) {
        this.spawnTimer = Math.max(0.28, 1.5 - this.wave * 0.06);
        this._spawnOne(this.queue.shift());
      }
    }

    this._topUpAllies(dt);

    const enemiesLeft = this.queue.length +
      game.agents.filter((a) => a.alive && a.faction === game.enemyFaction).length;
    game.hud.setEnemiesLeft(enemiesLeft);

    if (enemiesLeft === 0) this.endWave();
  }

  beginWave() {
    this.wave++;
    this.queue = this.planWave(this.wave);
    this.totalThisWave = this.queue.length;
    this.killedThisWave = 0;
    this.phase = PHASE.ACTIVE;
    this.spawnTimer = 0;

    const label = this.isBossWave ? 'HEAVY PUSH' : this.game.enemyFaction === 'police'
      ? 'Police pushing up the hill' : 'The hill is coming down on you';
    this.game.hud.setWave(this.wave, label);
    this.game.hud.banner(
      this.isBossWave ? `WAVE ${this.wave} — HEAVY PUSH` : `WAVE ${this.wave}`,
      label);
    audio.waveStart(this.isBossWave);

    /*
     * Give the wave a target. The spotter is picked a beat after the wave
     * starts rather than at spawn time, so there is a crowd to hide in — being
     * marked at the instant the first enemy walks out would make it a
     * whack-a-mole rather than a hunt.
     */
    this.game.spotter = null;
    this.game.hud.setObjective(null);
    if (this.wave >= 2 && !this.isBossWave) {
      setTimeout(() => {
        if (this.phase === PHASE.ACTIVE) this.game._markSpotter();
      }, 5200);
    }
  }

  endWave() {
    this.phase = PHASE.INTERMISSION;
    this.timer = 22;
    audio.waveClear();
    this.game.hud.banner(`WAVE ${this.wave} CLEARED`, 'Resupply — next push incoming');
    this.game.onWaveCleared(this.wave);
  }

  /* ── spawning ── */
  _spawnOne(arch) {
    const game = this.game;
    const spawns = game.world.meta.spawns[game.enemyFaction];
    if (!spawns?.length) return;

    const p = game.player;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const s = spawns[(Math.random() * spawns.length) | 0];
      const d = s.distanceTo(p.pos);
      if (d < 22) continue;
      const eye = _a.set(s.x, s.y + 1.5, s.z);
      const pe = _b.set(p.pos.x, p.pos.y + 1.5, p.pos.z);
      const hidden = game.world.collision.losBlocked(eye, pe);
      const score = (hidden ? 60 : 0) - Math.abs(d - 48);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (!best) best = spawns[(Math.random() * spawns.length) | 0];

    const agent = new Agent(game, arch, game.enemyFaction, best);
    if (arch.isBoss) {
      agent.model.root.scale.setScalar(1.22);
      agent.isBoss = true;
    }
    game.agents.push(agent);
  }

  _topUpAllies(dt = 0) {
    const game = this.game;
    this._allyTimer = (this._allyTimer ?? 0) - dt;
    const allies = game.agents.filter((a) => a.alive && a.faction === game.playerFaction);
    if (allies.length >= Math.min(this.alliesWanted, game.allyCap ?? 6)) return;
    if (this._allyTimer > 0) return;
    this._allyTimer = 3.5;

    const pool = GRUNTS[game.playerFaction];
    const arch = pool[Math.min(pool.length - 1, 1 + Math.floor(Math.random() * 2))];
    const spawns = game.world.meta.spawns[game.playerFaction];
    if (!spawns?.length) return;

    // allies come in behind the player
    let best = spawns[0], bd = Infinity;
    for (const s of spawns) {
      const d = Math.abs(s.distanceTo(game.player.pos) - 16);
      if (d < bd) { bd = d; best = s; }
    }
    const ally = new Agent(game, { ...arch, score: 0 }, game.playerFaction, best);
    ally.isAlly = true;
    game.agents.push(ally);
  }

  reset() {
    this.wave = 0;
    this.phase = PHASE.IDLE;
    this.queue.length = 0;
    this.timer = 0;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
export { PHASE };
