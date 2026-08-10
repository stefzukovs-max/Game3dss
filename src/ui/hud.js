import * as THREE from 'three';
import { clamp, lerp, now } from '../core/utils.js';
import { WEAPONS, WEAPON_ORDER } from '../systems/weapons.js';
import { zoneAt } from '../world/favela.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      hpFill: $('hp-fill'), hpGhost: $('hp-ghost'), hpNum: $('hp-num'),
      arFill: $('ar-fill'), arNum: $('ar-num'), arRow: $('ar-row'),
      stFill: $('st-fill'), stRow: $('st-row'),
      wpnName: $('wpn-name'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
      ammo: $('ammo'), reloadHint: $('reload-hint'),
      slots: $('wpn-slots'), reloadBar: $('reload-bar'),
      abIcon: $('ab-icon'), abKey: $('ab-key'), abName: $('ab-name'),
      abSweep: $('ab-sweep'), abBox: $('ability'),
      nadeCount: $('nade-count'), nadeBox: $('grenades'),
      waveLabel: $('wave-label'), waveSub: $('wave-sub'),
      enemiesLeft: $('enemies-left'), enemiesNum: $('enemies-num'),
      score: $('score'), streak: $('streak'), combo: $('combo'),
      killfeed: $('killfeed'), popups: $('popups'), banner: $('banner'),
      dmgRing: $('dmg-ring'), vignette: $('lowhp-vignette'),
      flash: $('flash-overlay'), burn: $('burn-overlay'),
      minimap: $('minimap'), zone: $('zone-name'),
      bossBar: $('boss-bar'), bossFill: $('boss-fill'), bossName: $('boss-name'),
      fps: $('fps'), interact: $('interact-prompt'),
      intermission: $('intermission'), interTime: $('inter-time'),
    };

    this.minimap = null;
    this.arrows = [];
    this.hpGhostVal = 1;
    this.comboCount = 0;
    this.comboUntil = 0;
    this.fpsAcc = 0; this.fpsFrames = 0; this.fpsVal = 0;
    this._lastZone = '';
    this._killfeedItems = [];
  }

  attachWorld(world) {
    this.minimap = new Minimap(this.el.minimap, world);
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  /* ══════════════ per-frame ══════════════ */
  update(dt, game) {
    const p = game.player;
    if (!p) return;

    // ── vitals ──
    const maxHp = p.maxHealth * p.upgrades.health;
    const hp = clamp(p.health / maxHp, 0, 1);
    this.el.hpFill.style.transform = `scaleX(${hp})`;
    this.el.hpNum.textContent = Math.ceil(p.health);
    this.el.hpFill.classList.toggle('low', hp < 0.3);
    this.hpGhostVal = hp > this.hpGhostVal ? hp : lerp(this.hpGhostVal, hp, 1 - Math.exp(-2.4 * dt));
    this.el.hpGhost.style.transform = `scaleX(${this.hpGhostVal})`;

    const maxAr = p.maxArmor || 0;
    const ar = maxAr > 0 ? clamp(p.armor / maxAr, 0, 1) : 0;
    this.el.arRow.style.display = maxAr > 0 ? '' : 'none';
    this.el.arFill.style.transform = `scaleX(${ar})`;
    this.el.arNum.textContent = Math.ceil(p.armor);

    const st = clamp(p.stamina / 100, 0, 1);
    this.el.stFill.style.transform = `scaleX(${st})`;
    this.el.stRow.classList.toggle('dim', st > 0.98);

    this.el.vignette.style.opacity = hp < 0.42 ? String((0.42 - hp) * 2.4) : '0';

    // ── weapon ──
    const w = p.weapon;
    if (w) {
      this.el.wpnName.textContent = w.def.name;
      this.el.ammoMag.textContent = w.mag;
      this.el.ammoRes.textContent = w.reserve;
      this.el.ammo.classList.toggle('empty', w.mag === 0);
      this.el.reloadHint.classList.toggle('hidden', !(w.mag / w.def.mag < 0.28 && !w.reloading && w.reserve > 0));

      if (w.reloading) {
        const k = clamp((now() - w.reloadStart) / (w.reloadEnd - w.reloadStart), 0, 1);
        this.el.reloadBar.classList.add('on');
        this.el.reloadBar.firstElementChild.style.width = (k * 100) + '%';
      } else {
        this.el.reloadBar.classList.remove('on');
      }
    }
    this._renderSlots(p);

    // ── ability + grenades ──
    const ab = p.char.ability;
    const cdTotal = ab.cooldown / (p.upgrades.cooldown || 1);
    const ready = p.abilityCd <= 0;
    this.el.abBox.classList.toggle('ready', ready);
    this.el.abBox.classList.toggle('active', p.abilityActive > 0);
    this.el.abSweep.style.height = ready ? '0%' : `${clamp(p.abilityCd / cdTotal, 0, 1) * 100}%`;
    this.el.abName.textContent = ready ? ab.name : Math.ceil(p.abilityCd) + 's';
    this.el.nadeCount.textContent = p.grenades;
    this.el.nadeBox.classList.toggle('empty', p.grenades <= 0);

    // ── crosshair ──
    const hs = Math.hypot(p.vel.x, p.vel.z);
    const spreadRad = w ? w.spread(p.aiming, hs, p.crouching) : 0.03;
    const px = clamp(spreadRad * 620, 2, 42);
    this.el.crosshair.style.setProperty('--spread', px.toFixed(1) + 'px');
    this.el.crosshair.classList.toggle('aiming', p.aiming);
    this.el.crosshair.classList.toggle('hostile', game.aimingAtHostile);

    // ── zone / compass ──
    const zone = zoneAt(p.pos.x, p.pos.z);
    if (zone !== this._lastZone) {
      this._lastZone = zone;
      this.el.zone.textContent = zone;
      this.el.zone.classList.remove('pop');
      void this.el.zone.offsetWidth;
      this.el.zone.classList.add('pop');
    }

    // ── damage arrows ──
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      if (a.life <= 0) { a.el.remove(); this.arrows.splice(i, 1); continue; }
      const ang = Math.atan2(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - p.yaw;
      a.el.style.transform = `rotate(${(-ang * 180 / Math.PI) - 90}deg)`;
      a.el.style.opacity = String(clamp(a.life / a.max, 0, 1));
    }

    // ── combo ──
    if (this.comboCount > 0 && now() > this.comboUntil) {
      this.comboCount = 0;
      this.el.combo.textContent = '';
      this.el.combo.classList.remove('on');
    }

    // ── boss bar ──
    const boss = game.agents.find((a) => a.isBoss && a.alive);
    if (boss) {
      this.el.bossBar.classList.remove('hidden');
      this.el.bossName.textContent = boss.nameTag;
      this.el.bossFill.style.transform =
        `scaleX(${clamp((boss.health + boss.armor) / (boss.maxHealth + boss.maxArmor), 0, 1)})`;
    } else {
      this.el.bossBar.classList.add('hidden');
    }

    // ── minimap ──
    if (this.minimap) {
      this.minimap.draw({
        player: p,
        agents: game.agents,
        pickups: game.pickups.items,
        revealed: game.abilities.revealUntil > now(),
      });
    }

    // ── fps ──
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fpsVal = Math.round(this.fpsFrames / this.fpsAcc);
      this.el.fps.textContent = this.fpsVal + ' FPS';
      this.fpsAcc = 0; this.fpsFrames = 0;
    }

    // ── overlays ──
    if (p.flashed > 0) this.el.flash.style.opacity = String(clamp(p.flashed / 3, 0, 0.95));
    else this.el.flash.style.opacity = '0';
    this.el.burn.style.opacity = p.burning > 0 ? '0.35' : '0';
  }

  _renderSlots(p) {
    const ids = WEAPON_ORDER.filter((id) => p.weapons[id]);
    const key = ids.join(',') + '|' + p.weaponId;
    if (this._slotKey === key) return;
    this._slotKey = key;
    this.el.slots.innerHTML = '';
    for (const id of ids) {
      const d = document.createElement('div');
      d.className = 'slot' + (id === p.weaponId ? ' on' : '');
      d.innerHTML = `<b>${WEAPONS[id].slot}</b> ${WEAPONS[id].short}`;
      this.el.slots.appendChild(d);
    }
  }

  /* ══════════════ events ══════════════ */
  onShot() { /* reserved for per-shot HUD reactions */ }

  hitmarker(kill, headshot) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (kill) h.classList.add('kill');
    if (headshot) this.popup('HEADSHOT', '#ffcf4d', -60);
  }

  damageFrom(pos, player) {
    const el = document.createElement('div');
    el.className = 'arrow';
    el.innerHTML = '<i></i>';
    this.el.dmgRing.appendChild(el);
    this.arrows.push({ el, pos: pos.clone ? pos.clone() : new THREE.Vector3().copy(pos), life: 1.3, max: 1.3 });
    this.flashDamage();
  }

  flashDamage() {
    this.el.hud.classList.remove('hurt');
    void this.el.hud.offsetWidth;
    this.el.hud.classList.add('hurt');
  }

  flash(t) { /* handled through player.flashed in update */ }

  popup(text, color = '#fff', yOff = 0) {
    const s = document.createElement('span');
    s.textContent = text;
    s.style.color = color;
    s.style.left = (48 + Math.random() * 4) + '%';
    s.style.top = (54 + yOff / 10 + Math.random() * 3) + '%';
    this.el.popups.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }

  damageNumber(amount, worldPos, camera, headshot) {
    const v = worldPos.clone().project(camera);
    if (v.z > 1) return;
    const s = document.createElement('span');
    s.textContent = Math.round(amount);
    s.style.color = headshot ? '#ffcf4d' : '#fff';
    s.style.fontSize = headshot ? '22px' : '17px';
    s.style.left = ((v.x * 0.5 + 0.5) * 100).toFixed(1) + '%';
    s.style.top = ((-v.y * 0.5 + 0.5) * 100).toFixed(1) + '%';
    this.el.popups.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }

  killfeed(killer, victim, weapon, headshot, isPlayer) {
    const d = document.createElement('div');
    d.innerHTML =
      `<span class="${isPlayer ? 'you' : ''}">${killer}</span>` +
      `<span class="kf-wpn${headshot ? ' hs' : ''}"> ${weapon} </span>` +
      `<span>${victim}</span>`;
    this.el.killfeed.appendChild(d);
    this._killfeedItems.push(d);
    if (this._killfeedItems.length > 5) this._killfeedItems.shift().remove();
    setTimeout(() => { d.remove(); const i = this._killfeedItems.indexOf(d); if (i >= 0) this._killfeedItems.splice(i, 1); }, 6000);
  }

  addCombo() {
    this.comboCount++;
    this.comboUntil = now() + 3.2;
    if (this.comboCount >= 2) {
      this.el.combo.textContent = `${this.comboCount}× COMBO`;
      this.el.combo.classList.add('on');
      this.el.combo.classList.remove('bump');
      void this.el.combo.offsetWidth;
      this.el.combo.classList.add('bump');
    }
    return this.comboCount;
  }

  setScore(n) { this.el.score.textContent = n.toLocaleString('en-US'); }

  setStreak(n) {
    const names = { 3: 'ON A ROLL', 5: 'DOMINATING', 8: 'UNSTOPPABLE', 12: 'THE HILL IS YOURS' };
    this.el.streak.textContent = n >= 3 ? (names[n] || `${n} STREAK`) : '';
  }

  setWave(n, sub) {
    this.el.waveLabel.textContent = n === 0 ? 'PREPARE' : `WAVE ${n}`;
    this.el.waveSub.textContent = sub || '';
    this.el.intermission.classList.add('hidden');
    this.el.enemiesLeft.classList.remove('hidden');
  }

  setIntermission(t) {
    this.el.intermission.classList.remove('hidden');
    this.el.enemiesLeft.classList.add('hidden');
    this.el.interTime.textContent = Math.ceil(t);
  }

  setEnemiesLeft(n) { this.el.enemiesNum.textContent = n; }

  banner(text, sub = '') {
    const b = this.el.banner;
    b.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  prompt(text) {
    if (text) {
      this.el.interact.classList.remove('hidden');
      this.el.interact.querySelector('span').textContent = text;
    } else {
      this.el.interact.classList.add('hidden');
    }
  }

  reset() {
    this.el.killfeed.innerHTML = '';
    this.el.popups.innerHTML = '';
    this.el.dmgRing.innerHTML = '';
    this.arrows.length = 0;
    this._killfeedItems.length = 0;
    this.comboCount = 0;
    this.el.combo.textContent = '';
    this.el.bossBar.classList.add('hidden');
  }
}
