/**
 * ══════════════════════════════════════════════════════════════════
 *  TAMBORZÃO — a baile funk sequencer
 * ══════════════════════════════════════════════════════════════════
 *
 * The map is a Rio hillside and the game had no music at all, which is a
 * strange thing for a place whose defining sound, to anyone who has been
 * near one, is a sound system three streets away that you feel before you
 * hear. So: a sequencer, not a loop.
 *
 * The pattern underneath it is the tamborzão — the beat almost every baile
 * funk track since the late nineties has been built on. Its signature is the
 * surdo landing on the tresillo (1 · 4 · 7 · 11 · 13 of sixteen) rather than
 * on the beat, so the whole thing leans forward and never quite resolves.
 * Everything else is decoration over that.
 *
 * A sequencer rather than a loop, for three reasons that all matter here:
 *   - it is bytes-free, and this game ships no audio files at all;
 *   - it can be re-voiced live, so the same engine plays a radio through a
 *     window and the combat bed, at different tempos and intensities;
 *   - it never audibly repeats, because the fills and the riff are picked
 *     from a seeded sequence rather than baked once.
 *
 * Scheduling uses the two-clock trick: `pump()` is called from the render
 * loop and schedules every step falling inside the next quarter second
 * against the audio clock, which is sample-accurate. The frame rate can do
 * whatever it likes; the beat does not move.
 */

/* the tamborzão, on a sixteenth grid */
const KICK  = [0, 3, 6, 10, 12];
const RIM   = [2, 5, 7, 8, 11, 13, 14];
const CLAP  = [4, 12];
const SHAKE = [0, 2, 4, 6, 8, 10, 12, 14];

/* Two bars of a minor vamp — i · VI · III · VII, the funk carioca staple. */
const ROOTS = [0, -4, -9, -2];
const RIFF = [
  [0, 0], [3, 2], [7, 3], [3, 6], [0, 8], [10, 10], [7, 11], [3, 14],
];

const SEMI = (n) => Math.pow(2, n / 12);

export class Tamborzao {
  /**
   * @param ctx      an AudioContext
   * @param dest     where the mix goes — a bus, or an emitter's own chain
   * @param opts     bpm, key (Hz of the tonic), seed, and voicing switches
   */
  constructor(ctx, dest, opts = {}) {
    this.ctx = ctx;
    this.dest = dest;
    this.bpm = opts.bpm ?? 130;
    this.key = opts.key ?? 55;          // A1
    this.gain = opts.gain ?? 1;
    this.riff = opts.riff !== false;    // window radios have it; the combat bed does not
    this.bass = opts.bass !== false;
    this.intensity = opts.intensity ?? 1;
    this.step = 0;
    this.nextTime = 0;
    this.running = false;
    this._seed = (opts.seed ?? 1) >>> 0;
    this.onStep = null;                 // so the world can flash a light on the kick
  }

  _rand() {
    this._seed = (this._seed * 1664525 + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  get stepDur() { return 60 / this.bpm / 4; }

  start(when = this.ctx.currentTime) {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = when + 0.05;
  }

  stop() { this.running = false; }

  /** Call once a frame. Schedules everything landing in the next 250 ms. */
  pump(lookahead = 0.25) {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + lookahead;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      this._emit(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % 64;   // four bars
    }
  }

  _emit(step, t) {
    const s = step % 16;
    const bar = (step / 16) | 0;
    const I = this.intensity;
    if (KICK.includes(s)) this._kick(t, 0.95 * I);
    if (RIM.includes(s)) this._rim(t, (s === 5 || s === 11 ? 0.5 : 0.3) * I);
    if (CLAP.includes(s)) this._clap(t, 0.42 * I);
    if (SHAKE.includes(s)) this._shake(t, 0.1 * I);

    /* a fill on the last half-bar of every fourth bar */
    if (bar === 3 && s >= 12 && this._rand() < 0.55) this._rim(t + this.stepDur * 0.5, 0.4 * I);

    if (this.bass && KICK.includes(s)) this._bassNote(t, ROOTS[bar], s === 0 ? 0.9 : 0.6);
    if (this.riff) {
      for (const [semi, at] of RIFF) if (at === s) this._riffNote(t, semi + ROOTS[bar]);
    }
    if (s === 0 && this.onStep) this.onStep(bar);
  }

  /* ── the kit ───────────────────────────────────────────────────── */

  _kick(t, v) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(105, t);
    o.frequency.exponentialRampToValueAtTime(41, t + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * this.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.19);
    o.connect(g).connect(this.dest);
    o.start(t); o.stop(t + 0.22);
  }

  /** The tamborim: a dry wooden tick, the thing that makes it carioca. */
  _rim(t, v) {
    const n = this._noise(0.06);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750 + this._rand() * 500;
    bp.Q.value = 5.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v * this.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0003, t + 0.035);
    n.connect(bp).connect(g).connect(this.dest);
    n.start(t); n.stop(t + 0.05);
  }

  _clap(t, v) {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.009;
      const n = this._noise(0.1);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1450; bp.Q.value = 1.1;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(v * this.gain * (i === 2 ? 1 : 0.5), at);
      g.gain.exponentialRampToValueAtTime(0.0003, at + (i === 2 ? 0.12 : 0.03));
      n.connect(bp).connect(g).connect(this.dest);
      n.start(at); n.stop(at + 0.15);
    }
  }

  _shake(t, v) {
    const n = this._noise(0.04);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v * this.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0003, t + 0.022);
    n.connect(hp).connect(g).connect(this.dest);
    n.start(t); n.stop(t + 0.04);
  }

  _bassNote(t, semi, v) {
    const f = this.key * SEMI(semi);
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.32 * this.gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.22);
    o.connect(lp).connect(g).connect(this.dest);
    o.start(t); o.stop(t + 0.25);
  }

  _riffNote(t, semi) {
    const f = this.key * 4 * SEMI(semi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11 * this.gain * this.intensity, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.16);
    g.connect(this.dest);
    // two saws a few cents apart — a chorus you get for the price of an oscillator
    for (const detune of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(g);
      o.start(t); o.stop(t + 0.2);
    }
  }

  /*
   * One second of noise, allocated once and read from a random offset. The
   * kit fires roughly forty hits a second and a fresh buffer per hit would
   * mean forty allocations and forty fills a second for no audible gain.
   */
  _noise(sec) {
    if (!Tamborzao._noiseBuf || Tamborzao._noiseBuf.sampleRate !== this.ctx.sampleRate) {
      const rate = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, rate, rate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < rate; i++) d[i] = Math.random() * 2 - 1;
      Tamborzao._noiseBuf = buf;
    }
    const s = this.ctx.createBufferSource();
    s.buffer = Tamborzao._noiseBuf;
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = 1;
    return s;
  }
}
