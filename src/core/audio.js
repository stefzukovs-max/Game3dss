import * as THREE from 'three';
import { Ambience } from '../audio/ambience.js';
import { Score } from '../audio/score.js';
import { VoiceBox } from '../audio/voice.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  AUDIO — synthesised, positional, layered
 * ══════════════════════════════════════════════════════════════════
 *
 * Nothing here is a file. Every sound in the game is built out of
 * oscillators and noise at the moment it is needed, which is why the whole
 * soundtrack costs zero bytes of download and zero seconds of load.
 *
 * That is a real constraint and it shows in places — you cannot synthesise a
 * human voice convincingly, and this does not try to. What it does instead is
 * spend the saved budget on things synthesis is *good* at: a music bed that
 * can be a genuine sequencer rather than a loop, reverb tails that respond to
 * whether you are standing in an alley or on a roof, and as many
 * simultaneous positional emitters as the mix has room for.
 *
 * STRUCTURE
 *
 *   emitters ─┬─► sfx   ─┐
 *             ├─► amb   ─┤
 *             ├─► music ─┼─► master ─► compressor ─► out
 *             └─► voice ─┘
 *                  │
 *                  └─ sends ─► alleyVerb / openVerb ─► master
 *
 * Four named buses, so ducking a category is one gain ramp rather than a
 * bookkeeping exercise, and two convolution reverbs living permanently on
 * sends — swapping a convolver's buffer per shot costs more than running both.
 */

/* How many seconds a layer stays "audible" for the purposes of activeLayers(). */
const LAYER_HOLD = 0.35;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bus = {};
    this.volume = 0.7;
    this.ready = false;
    this._noise = null;
    this.listenerPos = new THREE.Vector3();
    this.listenerFwd = new THREE.Vector3(0, 0, -1);
    /*
     * Where the listener is standing, acoustically. `enclosure` is 0 on an
     * open roof and 1 in a covered alley; `size` is how far the nearest walls
     * are. The world writes these once a frame; everything that makes a noise
     * reads them to decide how much tail it gets.
     */
    this.space = { enclosure: 0.35, size: 14 };
    this._layers = new Map();
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

    for (const [name, level] of [['sfx', 1], ['amb', 0.85], ['music', 0.6], ['voice', 0.9]]) {
      const g = this.ctx.createGain();
      g.gain.value = level;
      g.connect(this.master);
      this.bus[name] = g;
    }

    /*
     * Two spaces. The alley is small, bright and gone in a third of a second;
     * the hillside is a long dark slap off the blocks below you. A gunshot
     * sends to both, mixed by how enclosed the shooter is, which is the whole
     * reason firing from a roof sounds different from firing in a stairwell.
     */
    this.verb = {
      alley: this._convolver(0.34, 4200, 0.55),
      open: this._convolver(1.7, 1400, 0.16),
    };

    this._noise = this._makeNoiseBuffer(2);
    this.ready = true;
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Duck a bus — used to pull music and ambience down under the boss sting. */
  duck(busName, to, seconds = 0.4) {
    const b = this.bus[busName];
    if (!b) return;
    b.gain.cancelScheduledValues(this.now);
    b.gain.setValueAtTime(b.gain.value, this.now);
    b.gain.linearRampToValueAtTime(to, this.now + seconds);
  }

  /* ── the layer register ────────────────────────────────────────
   *
   * "Four simultaneous distinct audio layers" is the bar this phase set
   * itself, and a bar you cannot measure is a wish. So everything that makes
   * noise says so, by name, with a duration; `activeLayers()` reports what is
   * sounding right now and the audio check asserts on it.
   */
  mark(name, seconds = LAYER_HOLD) {
    if (!this.ready) return;
    const until = this.now + seconds;
    if ((this._layers.get(name) ?? 0) < until) this._layers.set(name, until);
  }

  activeLayers() {
    const t = this.now;
    const out = [];
    for (const [name, until] of this._layers) {
      if (until > t) out.push(name); else this._layers.delete(name);
    }
    return out;
  }

  /* ── ingredients ───────────────────────────────────────────────── */

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
   * An impulse response, grown rather than recorded: noise under an
   * exponential decay, tilted by a one-pole lowpass so long tails come back
   * darker than short ones — which is what actually happens outdoors.
   */
  _convolver(seconds, tone, wet) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    const k = Math.exp(-2 * Math.PI * tone / rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.6);
        // a touch of early-reflection sparseness rather than flat noise
        const grain = i < rate * 0.02 ? (Math.random() < 0.25 ? 1 : 0.15) : 1;
        last = (Math.random() * 2 - 1) * (1 - k) + last * k;
        d[i] = last * decay * grain;
      }
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = wet;
    const send = this.ctx.createGain();
    send.gain.value = 0;
    send.connect(conv).connect(g).connect(this.master);
    return { send, conv, wet: g };
  }

  /**
   * Positional gain + muffling. Returns the node to connect into, or null if
   * the sound is too far away to bother playing.
   */
  _spatial(pos, refDist = 12, maxDist = 130, busName = 'sfx') {
    const bus = this.bus[busName] || this.master;
    const g = this.ctx.createGain();
    if (!pos) { g.connect(bus); return { input: g, gain: 1, dist: 0 }; }

    const d = this.listenerPos.distanceTo(pos);
    if (d > maxDist) return null;
    const atten = refDist / (refDist + d * d * 0.035);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(420, 20000 - d * 165);

    const pan = this.ctx.createStereoPanner?.();
    g.connect(lp);
    if (pan) {
      /*
       * Left/right from the listener's own facing, not from world X. Cheap
       * cross product against up — the sign of it is all a stereo panner
       * needs, and it means turning your back on a firefight moves it.
       */
      const f = this.listenerFwd;
      const rx = -f.z, rz = f.x;
      const inv = 1 / Math.max(0.001, d);
      pan.pan.value = THREE.MathUtils.clamp(
        ((pos.x - this.listenerPos.x) * rx + (pos.z - this.listenerPos.z) * rz) * inv, -1, 1);
      lp.connect(pan); pan.connect(bus);
    } else { lp.connect(bus); }

    return { input: g, gain: atten, pan, dist: d, delay: d / 340 };
  }

  /** Feed a source into the two reverbs, mixed by how enclosed the shooter is. */
  _send(node, amount = 1, enclosure = this.space.enclosure) {
    if (!this.verb) return;
    const a = this.ctx.createGain();
    a.gain.value = amount * (0.25 + enclosure * 0.85);
    node.connect(a).connect(this.verb.alley.send);
    const o = this.ctx.createGain();
    o.gain.value = amount * (0.9 - enclosure * 0.7);
    node.connect(o).connect(this.verb.open.send);
    this.verb.alley.send.gain.value = 1;
    this.verb.open.send.gain.value = 1;
  }

  /* ── gunfire ──────────────────────────────────────────────────────
   *
   * Three layers, because that is what a gun is: the mechanism working, the
   * charge going off, and the hill answering.
   */
  gunshot(pos, { size = 1, suppressed = false, mech = 1 } = {}) {
    if (!this.ready) return;
    const sp = this._spatial(pos, 14, 190, 'sfx');
    if (!sp) return;
    const t = this.ctx.currentTime + (sp.delay || 0);
    const vol = (suppressed ? 0.22 : 0.85) * sp.gain;
    sp.input.gain.value = 1;
    this.mark('gunfire', suppressed ? 0.2 : 0.5);

    /* ── layer 1: the action ──
     * Bolt, spring, brass. Close-range detail only: at thirty metres you hear
     * the shot and nothing else, so it fades out faster than the report. */
    if (mech > 0 && sp.dist < 26) {
      const near = 1 - sp.dist / 26;
      this._mech(sp.input, t, 0.4 * mech * near * sp.gain, size);
    }

    /* ── layer 2: the body ── */
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

    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180 / size, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(vol * 0.75, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.14 * size);
    o.connect(og).connect(sp.input);
    o.start(t); o.stop(t + 0.2 * size);

    /* ── layer 3: the tail ──
     * Sent to both reverbs. In an alley you get a hard bright slap off the
     * two walls; from a rooftop the same shot rolls away down the hill for
     * over a second. Suppressed fire keeps the tail but loses the slap. */
    if (!suppressed) {
      this._send(ng, 0.9);
      this._send(og, 0.5);
      this._tail(sp, t, vol * 0.3, size);
    } else {
      this._send(ng, 0.25, 0.1);
    }
  }

  /** The mechanism: a metal clack and a spring ring. */
  _mech(dest, t, vol, size = 1) {
    const n = this._noiseSource(1.4);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200 / Math.sqrt(size);
    bp.Q.value = 2.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    n.connect(bp).connect(g).connect(dest);
    n.start(t); n.stop(t + 0.07);

    const ring = this.ctx.createOscillator();
    ring.type = 'square';
    ring.frequency.setValueAtTime(5200 + Math.random() * 700, t);
    const rg = this.ctx.createGain();
    rg.gain.setValueAtTime(vol * 0.22, t + 0.004);
    rg.gain.exponentialRampToValueAtTime(0.0003, t + 0.09);
    ring.connect(rg).connect(dest);
    ring.start(t + 0.004); ring.stop(t + 0.1);
  }

  _tail(sp, t, vol, size) {
    const enc = this.space.enclosure;
    const n = this._noiseSource(0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    // enclosed = brighter and shorter; open = darker and longer
    f.frequency.value = 500 + enc * 1400;
    const len = (0.35 + (1 - enc) * 1.05) * size;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.03);
    g.gain.linearRampToValueAtTime(vol * (0.7 + enc * 0.6), t + 0.05 + (1 - enc) * 0.06);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    n.connect(f).connect(g).connect(sp.input);
    n.start(t + 0.03); n.stop(t + len + 0.1);
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
    if (kind === 'metal') this._send(g, 0.4);
    this.mark('impacts', 0.3);
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
    this.mark('handling', 0.25);
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
    this.mark('footsteps', 0.4);
  }

  /** UI blips - no spatialisation. */
  tone(freq, dur = 0.1, vol = 0.25, type = 'square', when = 0, busName = 'sfx') {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g).connect(this.bus[busName] || this.master);
    o.start(t); o.stop(t + dur + 0.03);
    return g;
  }

  hitmarker(kill) {
    this.tone(kill ? 880 : 1500, 0.07, 0.2, 'square');
    if (kill) this.tone(1320, 0.14, 0.16, 'square', 0.06);
    this.mark('ui', 0.2);
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
    o.connect(g).connect(this.bus.sfx || this.master);
    o.start(t); o.stop(t + 0.3);
    this.mark('ui', 0.3);
  }

  pickup() {
    this.tone(660, 0.08, 0.2, 'triangle');
    this.tone(990, 0.12, 0.18, 'triangle', 0.07);
    this.mark('ui', 0.25);
  }

  /* ══════════════════════════════════════════════════════════════
   *  The world half — ambience, score, voice
   * ══════════════════════════════════════════════════════════════
   *
   * Kept behind this facade rather than wired into the game loop directly,
   * so that everything which already calls `audio.waveStart()` keeps working
   * and there is exactly one place that knows the mix exists.
   */

  attachWorld(collision) {
    if (!this.ready) return;
    this.ambience ??= new Ambience(this, collision);
    this.score ??= new Score(this);
    this.voicebox ??= new VoiceBox(this);
    this.ambience.collision = collision;
    this.ambience.start();
    this.score.start();
  }

  /**
   * Once a frame, with the camera's position and facing.
   *
   * `listenerPos` existed before this and was never once assigned, which
   * meant every distance attenuation in the game was measured from the world
   * origin — a shot at your feet on the summit was scored as eighty metres
   * away and a shot down in the plaza came through at full volume. The fix is
   * this line, and it changes the game more than anything else in the file.
   */
  updateWorld(dt, pos, fwd, threat = 0) {
    if (!this.ready) return;
    this.listenerPos.copy(pos);
    if (fwd) this.listenerFwd.copy(fwd).setY(0).normalize();
    this.ambience?.update(dt, this.listenerPos);
    this.score?.update(dt, threat);
  }

  /** Update the acoustic space from the world around the listener. */
  setSpace(enclosure, size) {
    this.space.enclosure = enclosure;
    this.space.size = size;
  }

  /**
   * Say a line. Returns the subtitle text if it was close enough to be
   * heard, so the caller can decide whether to put it on the HUD — an
   * unheard bark should not produce a radio caption.
   */
  bark(faction, key, pos, seed = 0) {
    return this.voicebox?.say(faction, key, pos, seed) ?? null;
  }

  waveStart(boss = false) {
    this.ambience?.firework();
    this.score?.waveStart(boss);
  }

  waveClear() { this.score?.waveClear(); }
  gameOver() { this.score?.gameOver(); }

  /** Silence the running beds — menu, death screen, tab hidden. */
  quiet() {
    this.score?.end();
    this.ambience?.stop();
  }
}

export const audio = new AudioEngine();
