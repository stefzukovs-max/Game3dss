import * as THREE from 'three';
import { Tamborzao } from './funk.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  AMBIENCE — the hill, making its own noise
 * ══════════════════════════════════════════════════════════════════
 *
 * Three beds, crossfaded by where you are standing on the slope:
 *
 *   PLAZA     traffic on the road below, a generator, radios, the odd horn.
 *   HILLSIDE  televisions through open windows, dogs, kids, buckets.
 *   SUMMIT    wind, loose zinc roofing, and the whole city humming a
 *             hundred metres below you.
 *
 * Plus three window emitters playing actual music — see funk.js — positioned
 * on the map, lowpassed by distance and muffled again when a wall is in the
 * way. Walking up the hill should sound like walking up a hill: the traffic
 * thins out, someone's television takes over, and then there is nothing but
 * wind and one sound system two terraces down that you can still feel.
 *
 * Everything below runs on the audio thread once it is built. The per-frame
 * cost of this whole file is three gain writes, three lowpass writes, and a
 * countdown — the LFOs modulating the wind and the traffic are oscillator
 * nodes wired straight into filter params, so the render loop never touches
 * them.
 */

const BEDS = ['plaza', 'hillside', 'summit'];

/** Where the sound systems are. Real places on the map, not decoration. */
const WINDOWS = [
  { id: 'dancehall', x: 40,  y: 12.5, z: -30, bpm: 132, key: 55.0, seed: 7,  loud: 1.0 },
  { id: 'bandstand', x: -6,  y: 2.0,  z: 46,  bpm: 128, key: 49.0, seed: 21, loud: 0.7 },
  { id: 'alleywin',  x: -46, y: 9.0,  z: -6,  bpm: 135, key: 58.3, seed: 44, loud: 0.55 },
];

const smooth = (x) => x * x * (3 - 2 * x);
const band = (v, a, b) => smooth(THREE.MathUtils.clamp((v - a) / (b - a), 0, 1));

export class Ambience {
  constructor(audio, collision = null) {
    this.audio = audio;
    this.collision = collision;
    this.beds = null;
    this.windows = [];
    this.weights = { plaza: 0, hillside: 0, summit: 0 };
    this._oneshots = [];
    this.enabled = true;
    this._probe = new THREE.Vector3();
  }

  /* ── build ─────────────────────────────────────────────────────── */

  start() {
    const A = this.audio;
    if (!A.ready || this.beds) return;
    const ctx = A.ctx;
    this.beds = {};

    for (const id of BEDS) {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(A.bus.amb);
      this.beds[id] = { gain: g, nodes: [] };
    }

    this._buildPlaza(ctx, this.beds.plaza);
    this._buildHillside(ctx, this.beds.hillside);
    this._buildSummit(ctx, this.beds.summit);

    /*
     * The intermittent half. A bed of noise alone reads as tape hiss; what
     * makes a place sound inhabited is that things happen in it at irregular
     * intervals you cannot predict.
     */
    this._oneshots = [
      { bed: 'plaza',    every: [7, 17],  fn: (v) => this._horn(v) },
      { bed: 'plaza',    every: [22, 50], fn: (v) => this._siren(v) },
      { bed: 'plaza',    every: [9, 21],  fn: (v) => this._moped(v) },
      { bed: 'hillside', every: [5, 14],  fn: (v) => this._dog(v) },
      { bed: 'hillside', every: [6, 15],  fn: (v) => this._tv(v) },
      { bed: 'hillside', every: [8, 20],  fn: (v) => this._clatter(v) },
      { bed: 'summit',   every: [6, 16],  fn: (v) => this._zinc(v) },
      { bed: 'summit',   every: [18, 44], fn: (v) => this._farCity(v) },
    ].map((o) => ({ ...o, t: 1 + Math.random() * o.every[1] }));

    for (const w of WINDOWS) {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      /*
       * A high-pass too. Sound through a wall is not just "darker" — the wall
       * is a mass, and mass passes bass. But a radio two streets away is also
       * *far*, and distance eats the very bottom as much as the top. The
       * combination is what makes it sit behind the world instead of on top
       * of it.
       */
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 60;
      const pan = ctx.createStereoPanner?.() ?? null;
      gain.connect(lp).connect(hp);
      if (pan) hp.connect(pan).connect(A.bus.amb); else hp.connect(A.bus.amb);

      const funk = new Tamborzao(ctx, gain, {
        bpm: w.bpm, key: w.key, seed: w.seed, gain: 0.9, riff: true, bass: true,
      });
      /*
       * `loud` is a number and `gain` is a GainNode, and they are deliberately
       * not both called gain — spreading the config over the node once made
       * `level` NaN, which threw out of setTargetAtTime every frame and took
       * the score and the reverb probe down with it. Non-finite AudioParam
       * writes fail loudly, which is the only reason that was a ten-minute
       * bug rather than a silent one.
       */
      this.windows.push({ ...w, pos: new THREE.Vector3(w.x, w.y, w.z), gain, lp, pan, funk, on: false });
    }
  }

  stop() {
    for (const w of this.windows) w.funk.stop();
    if (!this.beds) return;
    for (const id of BEDS) {
      const b = this.beds[id];
      b.gain.gain.setTargetAtTime(0.0001, this.audio.now, 0.3);
    }
  }

  /* ── the beds ──────────────────────────────────────────────────── */

  _loop(ctx, dest, { type, freq, q = 0.7, gain = 0.1, rate = 1 }) {
    const src = this.audio._noiseSource(rate);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(dest);
    src.start();
    return { src, filter: f, gain: g };
  }

  /**
   * A slow oscillator wired straight into an AudioParam — free modulation,
   * running on the audio thread where the frame rate cannot reach it.
   *
   * `until` matters: the beds start one of these each and keep it forever,
   * but the one-shots start one per event, and an oscillator with no stop
   * time is never collected. Left unbounded, a session's worth of television
   * bursts is a session's worth of leaked nodes.
   */
  _lfo(ctx, param, { rate = 0.1, depth = 100, type = 'sine', until = 0 } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    if (until) o.stop(until);
    return o;
  }

  _buildPlaza(ctx, bed) {
    // road rumble, breathing as traffic comes and goes
    const rumble = this._loop(ctx, bed.gain, { type: 'lowpass', freq: 190, q: 0.9, gain: 0.5, rate: 0.35 });
    this._lfo(ctx, rumble.filter.frequency, { rate: 0.055, depth: 70 });
    this._lfo(ctx, rumble.gain.gain, { rate: 0.031, depth: 0.16 });
    // the flat hiss of a city
    this._loop(ctx, bed.gain, { type: 'bandpass', freq: 1150, q: 0.35, gain: 0.05 });
    // a generator somewhere, always
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 58;
    const hg = ctx.createGain();
    hg.gain.value = 0.014;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass'; hf.frequency.value = 260;
    hum.connect(hf).connect(hg).connect(bed.gain);
    hum.start();
  }

  _buildHillside(ctx, bed) {
    this._loop(ctx, bed.gain, { type: 'lowpass', freq: 620, q: 0.7, gain: 0.16, rate: 0.5 });
    // televisions: a speech-shaped band that wobbles the way dialogue does
    const tv = this._loop(ctx, bed.gain, { type: 'bandpass', freq: 1500, q: 2.6, gain: 0.055 });
    this._lfo(ctx, tv.filter.frequency, { rate: 0.9, depth: 620 });
    this._lfo(ctx, tv.gain.gain, { rate: 0.42, depth: 0.045 });
    // and the drip a hillside of water tanks always has
    const drip = this._loop(ctx, bed.gain, { type: 'bandpass', freq: 3400, q: 6, gain: 0.012 });
    this._lfo(ctx, drip.gain.gain, { rate: 0.7, depth: 0.012, type: 'square' });
  }

  _buildSummit(ctx, bed) {
    const wind = this._loop(ctx, bed.gain, { type: 'bandpass', freq: 520, q: 0.6, gain: 0.28, rate: 0.7 });
    this._lfo(ctx, wind.filter.frequency, { rate: 0.075, depth: 300 });
    this._lfo(ctx, wind.gain.gain, { rate: 0.043, depth: 0.19 });   // gusts
    const low = this._loop(ctx, bed.gain, { type: 'lowpass', freq: 150, q: 0.8, gain: 0.13, rate: 0.3 });
    this._lfo(ctx, low.gain.gain, { rate: 0.028, depth: 0.09 });
  }

  /* ── the one-shots ─────────────────────────────────────────────── */

  _at(vol, refDist = 26) {
    /*
     * Ambient events are placed *around* the listener rather than at fixed
     * points: a dog that is always in the same doorway becomes furniture, and
     * you stop hearing it. Random bearing, random distance, every time.
     */
    const A = this.audio;
    const a = Math.random() * Math.PI * 2;
    const d = 8 + Math.random() * refDist;
    this._probe.set(
      A.listenerPos.x + Math.cos(a) * d, A.listenerPos.y + (Math.random() - 0.3) * 6,
      A.listenerPos.z + Math.sin(a) * d);
    const sp = A._spatial(this._probe, 14, 120, 'amb');
    if (sp) { sp.input.gain.value = 1; A.mark('ambient-event', 1.2); }
    return sp ? { sp, t: A.now, vol: vol * sp.gain } : null;
  }

  _horn(vol) {
    const s = this._at(vol); if (!s) return;
    const { sp, t } = s;
    const two = Math.random() < 0.5;
    for (let i = 0; i < (two ? 2 : 1); i++) {
      const at = t + i * 0.28;
      for (const f of [420, 528]) {
        const o = this.audio.ctx.createOscillator();
        o.type = 'square'; o.frequency.value = f * (0.94 + Math.random() * 0.12);
        const g = this.audio.ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(s.vol * 0.09, at + 0.02);
        g.gain.setValueAtTime(s.vol * 0.09, at + 0.16);
        g.gain.exponentialRampToValueAtTime(0.0004, at + 0.24);
        o.connect(g).connect(sp.input);
        o.start(at); o.stop(at + 0.3);
      }
    }
  }

  _siren(vol) {
    const s = this._at(vol, 70); if (!s) return;
    const { sp, t } = s;
    const o = this.audio.ctx.createOscillator();
    o.type = 'sine';
    const g = this.audio.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(s.vol * 0.05, t + 0.6);
    g.gain.setValueAtTime(s.vol * 0.05, t + 3.4);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 4.6);
    // the two-tone European wail, which is what Rio actually uses
    for (let i = 0; i < 10; i++) {
      o.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.45);
    }
    const lp = this.audio.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    o.connect(lp).connect(g).connect(sp.input);
    o.start(t); o.stop(t + 4.8);
  }

  _moped(vol) {
    const s = this._at(vol, 40); if (!s) return;
    const { sp, t } = s;
    const o = this.audio.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(155, t + 1.6);
    o.frequency.linearRampToValueAtTime(96, t + 2.6);
    const lp = this.audio.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = this.audio.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(s.vol * 0.055, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 3.0);
    o.connect(lp).connect(g).connect(sp.input);
    o.start(t); o.stop(t + 3.1);
  }

  _dog(vol) {
    const s = this._at(vol, 30); if (!s) return;
    const { sp, t } = s;
    const n = 1 + ((Math.random() * 3) | 0);
    const base = 220 + Math.random() * 180;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.19 + Math.random() * 0.08);
      const o = this.audio.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 1.5, at);
      o.frequency.exponentialRampToValueAtTime(base * 0.7, at + 0.09);
      const bp = this.audio.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.2;
      const g = this.audio.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(s.vol * 0.13, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 0.13);
      o.connect(bp).connect(g).connect(sp.input);
      o.start(at); o.stop(at + 0.16);
    }
  }

  _tv(vol) {
    const s = this._at(vol, 18); if (!s) return;
    const { sp, t } = s;
    // a burst of canned laughter, or a football crowd — both are noise swells
    const src = this.audio._noiseSource(1);
    const bp = this.audio.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.6;
    const g = this.audio.ctx.createGain();
    const len = 1.2 + Math.random() * 1.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(s.vol * 0.07, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0004, t + len);
    this._lfo(this.audio.ctx, bp.frequency, { rate: 5.5, depth: 380, until: t + len + 0.2 });
    src.connect(bp).connect(g).connect(sp.input);
    src.start(t); src.stop(t + len + 0.1);
  }

  _clatter(vol) {
    const s = this._at(vol, 22); if (!s) return;
    const { sp, t } = s;
    for (let i = 0; i < 3 + ((Math.random() * 3) | 0); i++) {
      const at = t + i * (0.05 + Math.random() * 0.09);
      const n = this.audio._noiseSource(1);
      const bp = this.audio.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400 + Math.random() * 2600;
      bp.Q.value = 7;
      const g = this.audio.ctx.createGain();
      g.gain.setValueAtTime(s.vol * 0.07, at);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 0.1);
      n.connect(bp).connect(g).connect(sp.input);
      n.start(at); n.stop(at + 0.13);
    }
  }

  /** Loose corrugated roofing in the wind — the summit's signature. */
  _zinc(vol) {
    const s = this._at(vol, 20); if (!s) return;
    const { sp, t } = s;
    const n = this.audio._noiseSource(1);
    const bp = this.audio.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 4;
    const g = this.audio.ctx.createGain();
    const len = 0.5 + Math.random() * 0.8;
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 5; i++) {
      g.gain.linearRampToValueAtTime(s.vol * 0.06 * Math.random(), t + len * (i / 5));
    }
    g.gain.exponentialRampToValueAtTime(0.0004, t + len);
    n.connect(bp).connect(g).connect(sp.input);
    n.start(t); n.stop(t + len + 0.1);
  }

  /** The city, from above: one long swell of everything at once. */
  _farCity(vol) {
    const s = this._at(vol, 90); if (!s) return;
    const { sp, t } = s;
    const n = this.audio._noiseSource(0.4);
    const lp = this.audio.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.audio.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(s.vol * 0.09, t + 2.4);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 6.5);
    n.connect(lp).connect(g).connect(sp.input);
    n.start(t); n.stop(t + 6.6);
  }

  /**
   * A firework, going up.
   *
   * Not decoration: in Rio this is the actual signalling system. Lookouts set
   * off rojões when police enter the community, and everyone on the hill
   * knows what it means before a single radio call goes out. The game fires
   * one at the top of every wave, which makes the alarm diegetic — the player
   * hears the hill warning itself.
   */
  firework(pos = null) {
    const A = this.audio;
    if (!A.ready) return;
    const p = pos || this._probe.set(
      A.listenerPos.x + (Math.random() - 0.5) * 60, A.listenerPos.y + 30,
      A.listenerPos.z - 30 - Math.random() * 30);
    const sp = A._spatial(p, 40, 240, 'amb');
    if (!sp) return;
    sp.input.gain.value = 1;
    const t = A.now;

    // the whistle going up
    const o = A.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(2100, t + 0.9);
    const og = A.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.1 * sp.gain, t + 0.15);
    og.gain.exponentialRampToValueAtTime(0.0004, t + 0.95);
    o.connect(og).connect(sp.input);
    o.start(t); o.stop(t + 1.0);

    // and the bang
    const bang = t + 1.0;
    const n = A._noiseSource(0.6);
    const lp = A.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, bang);
    lp.frequency.exponentialRampToValueAtTime(300, bang + 0.5);
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.5 * sp.gain, bang);
    g.gain.exponentialRampToValueAtTime(0.0004, bang + 0.7);
    n.connect(lp).connect(g).connect(sp.input);
    n.start(bang); n.stop(bang + 0.8);
    A._send(g, 1.1, 0.05);      // it is above the roofs — all open reverb
    A.mark('ambient-event', 2.0);
  }

  /* ── per frame ─────────────────────────────────────────────────── */

  update(dt, listener) {
    if (!this.beds || !this.enabled) return;
    const A = this.audio;
    const z = listener.z;

    /*
     * Bed weights. The plaza bleeds a long way up the hill because sound
     * carries upward off a slope, and the summit bed comes in early because
     * wind is the first thing you notice. They overlap deliberately — a hard
     * switch at a terrace boundary would be audible as a switch.
     */
    const plaza = band(z, 4, 40);
    const summit = 1 - band(z, -56, -20);
    const hill = Math.max(0.12, 1 - plaza * 0.85 - summit * 0.85);
    const w = this.weights;
    w.plaza = plaza; w.hillside = hill; w.summit = summit;

    const now = A.now;
    for (const id of BEDS) {
      const target = Math.max(0.0001, w[id]);
      this.beds[id].gain.gain.setTargetAtTime(target, now, 0.5);
      if (w[id] > 0.1) A.mark(`amb-${id}`, 0.6);
    }

    for (const o of this._oneshots) {
      if (w[o.bed] < 0.15) continue;
      o.t -= dt * w[o.bed];
      if (o.t > 0) continue;
      o.t = o.every[0] + Math.random() * (o.every[1] - o.every[0]);
      o.fn(w[o.bed]);
    }

    this._updateWindows(listener);
  }

  _updateWindows(listener) {
    const A = this.audio;
    const f = A.listenerFwd;
    for (const win of this.windows) {
      const d = listener.distanceTo(win.pos);
      const audible = d < 85;
      if (audible && !win.on) { win.funk.start(); win.on = true; }
      else if (!audible && win.on) { win.funk.stop(); win.on = false; }
      if (!audible) continue;

      win.funk.pump();

      /*
       * Occlusion. One ray from the listener to the speaker: if a wall is in
       * the way the top end goes, which is exactly what you hear standing
       * round the corner from a party. Without this the music sits on top of
       * the mix at full brightness from anywhere with line of sight to the
       * general area, and the hill stops having corners.
       */
      let blocked = false;
      if (this.collision) {
        blocked = this.collision.losBlocked(
          this._probe.copy(listener).setY(listener.y + 1.4), win.pos);
      }

      const near = 1 - Math.min(1, d / 85);
      const level = win.loud * 0.5 * near * near * (blocked ? 0.55 : 1);
      win.gain.gain.setTargetAtTime(Math.max(0.0001, level), A.now, 0.25);
      win.lp.frequency.setTargetAtTime(
        Math.max(170, (blocked ? 520 : 2600) - d * 18), A.now, 0.3);
      if (win.pan) {
        const rx = -f.z, rz = f.x;
        const inv = 1 / Math.max(0.001, d);
        win.pan.pan.setTargetAtTime(THREE.MathUtils.clamp(
          ((win.pos.x - listener.x) * rx + (win.pos.z - listener.z) * rz) * inv, -1, 1),
        A.now, 0.15);
      }
      if (level > 0.008) A.mark('music-diegetic', 0.6);
    }
  }
}
