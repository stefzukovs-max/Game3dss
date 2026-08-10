import * as THREE from 'three';
import { audio } from '../core/audio.js';

/**
 * Floating crates the player walks over (or hoovers up, if they're Camargo).
 * Spawned between waves and occasionally dropped by elites.
 */
const TYPES = {
  health: { color: 0x2fd06a, emissive: 0x0a3a1c, label: '+HP', size: 0.42 },
  armor:  { color: 0x4ea3ff, emissive: 0x0a2044, label: '+AR', size: 0.42 },
  ammo:   { color: 0xffc23d, emissive: 0x3a2a05, label: 'AMMO', size: 0.38 },
  grenade:{ color: 0xd2542f, emissive: 0x3a1005, label: 'NADE', size: 0.34 },
};

export class PickupSystem {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.mats = {};
    for (const [k, v] of Object.entries(TYPES)) {
      this.mats[k] = new THREE.MeshLambertMaterial({ color: v.color, emissive: v.emissive });
    }
    this.ringGeo = new THREE.RingGeometry(0.45, 0.6, 16);
  }

  spawn(type, pos) {
    const cfg = TYPES[type];
    if (!cfg) return;
    const g = new THREE.Group();
    const box = new THREE.Mesh(this.geo, this.mats[type]);
    box.scale.setScalar(cfg.size);
    box.castShadow = true;
    g.add(box);

    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: cfg.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.34;
    g.add(ring);

    const ground = this.game.world.collision.groundHeight(pos.x, pos.z, pos.y + 2, 0.4);
    g.position.set(pos.x, Math.max(ground, pos.y) + 0.55, pos.z);
    this.game.scene.add(g);
    this.items.push({ mesh: g, type, life: 60, phase: Math.random() * 6, dead: false });
  }

  /** Scatter a set of crates across the map's pickup spots for the next wave. */
  restock(count = 6) {
    const spots = this.game.world.meta.pickups;
    if (!spots.length) return;
    const player = this.game.player;
    const pool = ['health', 'ammo', 'ammo', 'armor', 'grenade'];
    for (let i = 0; i < count; i++) {
      // bias toward spots near the player so restocking isn't a scavenger hunt
      let best = null, bd = Infinity;
      for (let k = 0; k < 8; k++) {
        const p = spots[(Math.random() * spots.length) | 0];
        const d = Math.abs(p.distanceTo(player.pos) - 28);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) this.spawn(pool[(Math.random() * pool.length) | 0], best);
    }
  }

  dropFrom(agent) {
    const r = Math.random();
    if (r < 0.16) this.spawn('health', agent.pos);
    else if (r < 0.42) this.spawn('ammo', agent.pos);
    else if (r < 0.5) this.spawn('armor', agent.pos);
    else if (r < 0.56) this.spawn('grenade', agent.pos);
  }

  update(dt) {
    const p = this.game.player;
    const magnet = p?.char.passive.id === 'logistics' ? 6 : 1.55;

    for (const it of this.items) {
      it.life -= dt;
      it.phase += dt;
      it.mesh.rotation.y += dt * 1.4;
      it.mesh.children[0].position.y = Math.sin(it.phase * 2.2) * 0.11;
      if (it.life < 6) it.mesh.visible = Math.floor(it.life * 6) % 2 === 0;
      if (it.life <= 0) { it.dead = true; continue; }

      if (!p || !p.alive) continue;
      const d = it.mesh.position.distanceTo(p.pos);
      if (d < magnet && Math.abs(it.mesh.position.y - p.pos.y) < 3) {
        if (this._collect(it.type, p)) it.dead = true;
      }
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].dead) {
        this.game.scene.remove(this.items[i].mesh);
        this.items.splice(i, 1);
      }
    }
  }

  _collect(type, p) {
    const hud = this.game.hud;
    switch (type) {
      case 'health': {
        if (p.health >= p.maxHealth * p.upgrades.health - 0.5) return false;
        p.heal(45);
        hud.popup('+45 HP', '#4ade80');
        break;
      }
      case 'armor': {
        if (p.armor >= (p.maxArmor || 50)) return false;
        p.addArmor(40);
        hud.popup('+40 ARMOR', '#60a5fa');
        break;
      }
      case 'ammo': {
        let any = false;
        for (const w of Object.values(p.weapons)) {
          if (w.addAmmo(Math.ceil(w.def.mag * 1.6 * p.upgrades.ammo)) > 0) any = true;
        }
        if (!any) return false;
        hud.popup('AMMO', '#ffc23d');
        break;
      }
      case 'grenade': {
        if (p.grenades >= p.maxGrenades + 2) return false;
        p.grenades = Math.min(p.maxGrenades + 2, p.grenades + 2);
        hud.popup('+2 GRENADES', '#f97316');
        break;
      }
    }
    audio.pickup();
    return true;
  }

  clear() {
    for (const it of this.items) this.game.scene.remove(it.mesh);
    this.items.length = 0;
  }
}
