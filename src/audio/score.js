import { Tamborzao } from './funk.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  SCORE — the music that knows what is happening
 * ══════════════════════════════════════════════════════════════════
 *
 * The game already has music in the world: three window emitters playing
 * baile funk that belongs to the hill, not to the player. This is the other
 * kind — the score, which belongs to the fight.
 *
 * The two are deliberately the same engine at different settings, because
 * the alternative is a soundtrack that has nothing to do with the place it
 * is playing in. The score is the radios' beat taken half-time, stripped of
 * its riff, dropped an octave and left to grind: recognisably the same music
 * with the fun taken out of it. When the wave starts and the score comes up,
 * the radios duck under it and you are hearing the neighbourhood's own tune
 * turned into a threat.
 *
 * Intensity is driven from the fight, not from a timer — how close the
 * nearest hostile is, and how many of them there are. Standing alone on a
 * roof between contacts, the score thins to a drone and the hill comes back.
 */
export class Score {
  constructor(audio) {
    this.audio = audio;
    this.bed = null;
    this.drone = null;
    this.intensity = 0;
    this._target = 0;
    this.playing = false;
  }

  start() {
    const A = this.audio;
    if (!A.ready || this.bed) return;
    const ctx = A.ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.out.connect(A.bus.music);

    this.bed = new Tamborzao(ctx, this.out, {
      bpm: 96, key: 41.2, seed: 3, gain: 0.85, riff: false, bass: true,
    });

    /* A drone under everything, so silence between hits is not silence. */
    const d = ctx.createGain();
    d.gain.value = 0.0001;
    d.connect(A.bus.music);
    for (const [f, lvl] of [[41.2, 0.10], [61.7, 0.05], [82.4, 0.03]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 1.4;
      const g = ctx.createGain(); g.gain.value = lvl;
      o.connect(lp).connect(g).connect(d);
      o.start();
    }
    this.drone = d;
  }

  /** Bring the score in. `boss` makes it heavier and slower. */
  begin(boss = false) {
    if (!this.bed) this.start();
    if (!this.bed) return;
    this.bed.bpm = boss ? 88 : 96;
    this.bed.key = boss ? 36.7 : 41.2;
    this.bed.start();
    this.playing = true;
    this.audio.duck('amb', boss ? 0.42 : 0.55, 1.2);
  }

  end() {
    if (!this.bed) return;
    this.bed.stop();
    this.playing = false;
    this._target = 0;
    this.out.gain.setTargetAtTime(0.0001, this.audio.now, 0.6);
    this.drone.gain.setTargetAtTime(0.0001, this.audio.now, 1.2);
    this.audio.duck('amb', 0.85, 1.6);
  }

  /**
   * @param threat 0..1 — how much trouble the player is in right now
   */
  update(dt, threat = 0) {
    if (!this.bed) return;
    this._target = threat;
    this.intensity += (this._target - this.intensity) * Math.min(1, dt * 0.7);
    if (!this.playing) return;

    this.bed.intensity = 0.35 + this.intensity * 0.65;
    const A = this.audio;
    this.out.gain.setTargetAtTime(0.16 + this.intensity * 0.5, A.now, 0.8);
    this.drone.gain.setTargetAtTime(0.5 + this.intensity * 0.5, A.now, 1.4);
    this.bed.pump();
    A.mark('score', 0.6);
    A.mark('score-drone', 0.6);
  }

  /* ── the stings ────────────────────────────────────────────────── */

  waveStart(boss = false) {
    const A = this.audio;
    if (!A.ready) return;
    if (boss) {
      // three low hits, spaced wide, the last one held
      [0, 0.42, 0.84].forEach((at, i) => {
        this._stab(36.7 * (i === 2 ? 1 : 2), at, i === 2 ? 1.6 : 0.3, 0.34);
      });
      A.duck('sfx', 0.7, 0.2);
      setTimeout(() => A.duck('sfx', 1, 0.9), 1400);
    } else {
      [0, 0.13, 0.26].forEach((at, i) => this._stab(55 * Math.pow(2, i / 12 * 5), at, 0.4, 0.2));
    }
    this.begin(boss);
  }

  waveClear() {
    // resolves upward — the only time anything in this game does
    [0, 0.11, 0.22, 0.36].forEach((at, i) => {
      this.audio.tone([220, 261.6, 329.6, 440][i], 0.5, 0.12, 'triangle', at, 'music');
    });
    this.end();
  }

  gameOver() {
    this.end();
    [0, 0.24, 0.5, 0.86].forEach((at, i) => {
      this._stab([98, 82.4, 65.4, 49][i], at, i === 3 ? 2.4 : 0.5, 0.3);
    });
  }

  _stab(freq, when, len, vol) {
    const A = this.audio;
    const ctx = A.ctx;
    const t = A.now + when;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t + len);
    g.connect(A.bus.music);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + len);
    lp.connect(g);
    for (const det of [-9, 0, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(t); o.stop(t + len + 0.05);
    }
    A._send(g, 0.5, 0.2);
    A.mark('sting', when + len);
  }
}
