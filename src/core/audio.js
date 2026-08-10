import * as THREE from 'three';

/**
 * Everything is synthesised at runtime - no audio files to ship or load.
 * Gunshots are a noise burst through a swept resonant filter plus a low
 * "thump" body; distance gives you rolloff and a lowpass so far-away fire
 * sounds muffled and close fire cracks.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.ready = false;
    this._noise = null;
    this.listenerPos = new THREE.Vector3();
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 9;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    this.master.connect(comp).connect(this.ctx.destination);
    this._noise = this._makeNoiseBuffer(2);
    this.ready = true;
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _makeNoiseBuffer(sec) {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource(playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.playbackRate.value = playbackRate;
    s.loop = true;
    return s;
  }

  /**
   * Positional gain + muffling. Returns the node to connect into, or null if
   * the sound is too far away to bother playing.
   */
  _spatial(pos, refDist = 12, maxDist = 130) {
    const g = this.ctx.createGain();
    if (!pos) { g.connect(this.master); return { input: g, gain: 1 }; }

    const d = this.listenerPos.distanceTo(pos);
    if (d > maxDist) return null;
    const atten = refDist / (refDist + d * d * 0.035);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(420, 20000 - d * 165);

    const pan = this.ctx.createStereoPanner?.();
    g.connect(lp);
    if (pan) { lp.connect(pan); pan.connect(this.master); } else { lp.connect(this.master); }

    return { input: g, gain: atten, pan, delay: d / 340 };
  }

  /* ── gunfire ──────────────────────────────────────────────── */
  gunshot(pos, { size = 1, suppressed = false } = {}) {
    if (!this.ready) return;
    const sp = this._spatial(pos, 14, 190);
    if (!sp) return;
    const t = this.ctx.currentTime + (sp.delay || 0);
    const vol = (suppressed ? 0.22 : 0.85) * sp.gain;

    // crack
    const n = this._noiseSource(1 + Math.random() * 0.2);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2600 / size, t);
    bp.frequency.exponentialRampToValueAtTime(320 / size, t + 0.12);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + (suppressed ? 0.07 : 0.19 * size));
    n.connect(bp).connect(ng).connect(sp.input);
    n.start(t); n.stop(t + 0.3 * size);

    // body thump
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180 / size, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(vol * 0.75, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.14 * size);
    o.connect(og).connect(sp.input);
    o.start(t); o.stop(t + 0.2 * size);

    sp.input.gain.value = 1;

    // a little slapback so shots in the alleys feel enclosed
    if (!suppressed) this._tail(sp, t, vol * 0.3, size);
  }

  _tail(sp, t, vol, size) {
    const n = this._noiseSource(0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.03);
    g.gain.linearRampToValueAtTime(vol, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.55 * size);
    n.connect(f).connect(g).connect(sp.input);
    n.start(t + 0.03); n.stop(t + 0.7 * size);
  }

  /** Bullet smacking concrete / metal / flesh. */
  impact(pos, kind = 'concrete') {
    if (!this.ready) return;
    const sp = this._spatial(pos, 8, 90);
    if (!sp) return;
    const t = this.ctx.currentTime + (sp.delay || 0);
    const cfg = {
      concrete: { f: 1800, q: 1.4, d: 0.08, v: 0.5 },
      metal:    { f: 3600, q: 9.0, d: 0.30, v: 0.4 },
      flesh:    { f: 420,  q: 0.8, d: 0.11, v: 0.65 },
      wood:     { f: 1100, q: 2.0, d: 0.10, v: 0.45 },
    }[kind] || { f: 1800, q: 1.4, d: 0.08, v: 0.5 };

    const n = this._noiseSource(1.6);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = cfg.f * (0.8 + Math.random() * 0.4);
    bp.Q.value = cfg.q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(cfg.v * sp.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + cfg.d);
    n.connect(bp).connect(g).connect(sp.input);
    sp.input.gain.value = 1;
    n.start(t); n.stop(t + cfg.d + 0.05);
  }

  /** Short mechanical click - reload, weapon swap, dry fire. */
  click(pos, freq = 900, vol = 0.35, dur = 0.045) {
    if (!this.ready) return;
    const sp = this._spatial(pos, 6, 60);
    if (!sp) return;
    const t = this.ctx.currentTime;
    const n = this._noiseSource(1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * sp.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    n.connect(bp).connect(g).connect(sp.input);
    sp.input.gain.value = 1;
    n.start(t); n.stop(t + dur + 0.02);
  }

  reload(pos) {
    this.click(pos, 700, 0.3);
    setTimeout(() => this.click(pos, 1200, 0.26), 140);
    setTimeout(() => this.click(pos, 520, 0.34, 0.07), 340);
  }

  footstep(pos, running) {
    if (!this.ready) return;
    const sp = this._spatial(pos, 5, 40);
    if (!sp) return;
    const t = this.ctx.currentTime;
    const n = this._noiseSource(1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = running ? 1500 : 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime((running ? 0.16 : 0.09) * sp.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.07);
    n.connect(f).connect(g).connect(sp.input);
    sp.input.gain.value = 1;
    n.start(t); n.stop(t + 0.1);
  }

  /** UI blips - no spatialisation. */
  tone(freq, dur = 0.1, vol = 0.25, type = 'square', when = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  hitmarker(kill) {
    this.tone(kill ? 880 : 1500, 0.07, 0.2, 'square');
    if (kill) this.tone(1320, 0.14, 0.16, 'square', 0.06);
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }

  waveStart() {
    [330, 415, 494].forEach((f, i) => this.tone(f, 0.5, 0.13, 'sawtooth', i * 0.1));
  }
  waveClear() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 0.13, 'triangle', i * 0.09));
  }
  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.7, 0.16, 'sawtooth', i * 0.19));
  }
  pickup() {
    this.tone(660, 0.08, 0.2, 'triangle');
    this.tone(990, 0.12, 0.18, 'triangle', 0.07);
  }
}

export const audio = new AudioEngine();
