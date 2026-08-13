/**
 * ══════════════════════════════════════════════════════════════════
 *  VOICE — formant synthesis for barks
 * ══════════════════════════════════════════════════════════════════
 *
 * A game with no audio files cannot have voice acting, and pretending
 * otherwise with a text-to-speech call would be worse than nothing: the
 * browser's voices are wrong for the register, wildly different per device,
 * and cannot be positioned in the world.
 *
 * So this does what Animal Crossing and The Sims both did, for the same
 * reason — it synthesises the *shape* of speech and lets the subtitle carry
 * the words. A buzzing glottal source at a shouted pitch, run through three
 * parallel bandpass filters tuned to the formants of a vowel, is recognisably
 * a human voice from thirty metres away even though it says nothing. Add a
 * consonant burst in front of each syllable and a falling pitch contour
 * across the line and it reads as someone shouting at you across a courtyard,
 * which is all a bark has to do.
 *
 * The two factions get different throats. The battalion is lower, tighter,
 * and squeezed through a radio band with a squelch either side of it, because
 * they are talking to each other on a net. The crew is higher, louder, wide
 * open, and shouted across rooftops.
 */

/* F1/F2/F3, in Hz — the standard measured values for a male speaker. */
const VOWELS = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
};

/*
 * The barks. `v` is the vowel sequence — one per syllable — and the text is
 * the subtitle. Written to the cadence of the Portuguese, so the syllable
 * count and the stress land where a player who speaks it would expect.
 */
export const BARKS = {
  police: {
    contact:  { v: 'ao',   text: 'Contato!' },
    reload:   { v: 'eaoo', text: 'Recarregando!' },
    grenade:  { v: 'aaa',  text: 'Granada!' },
    push:     { v: 'oa',   text: 'Avança!' },
    down:     { v: 'ii',   text: 'Homem caído!' },
    clear:    { v: 'io',   text: 'Limpo!' },
  },
  crew: {
    contact:  { v: 'oae',  text: 'Olha eles!' },
    reload:   { v: 'aoo',  text: 'Tô sem bala!' },
    grenade:  { v: 'aaa',  text: 'Granada!' },
    push:     { v: 'eoe',  text: 'Desce nele!' },
    down:     { v: 'aiu',  text: 'Caiu um!' },
    clear:    { v: 'aou',  text: 'Foi embora!' },
  },
};

const THROAT = {
  police: { f0: 108, spread: 0.10, radio: true,  vol: 0.55, rate: 0.135 },
  crew:   { f0: 146, spread: 0.22, radio: false, vol: 0.72, rate: 0.155 },
};

export class VoiceBox {
  constructor(audio) { this.audio = audio; }

  /**
   * Say one line at a world position.
   *
   * @param faction  'police' | 'crew' — picks the throat
   * @param key      one of the six bark keys
   * @param pos      world position, or null for the player's own squad net
   * @param seed     so the same NPC sounds like the same NPC every time
   */
  say(faction, key, pos, seed = 0) {
    const A = this.audio;
    if (!A.ready) return null;
    const bark = (BARKS[faction] ?? BARKS.crew)[key];
    if (!bark) return null;
    const th = THROAT[faction] ?? THROAT.crew;

    const sp = A._spatial(pos, 10, 62, 'voice');
    if (!sp) return null;
    sp.input.gain.value = 1;

    /* Per-speaker pitch, stable for a given seed. */
    const jitter = ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const f0 = th.f0 * (1 + (jitter - 0.5) * 2 * th.spread);

    let node = sp.input;
    if (th.radio) node = this._radioBand(sp.input);

    const t0 = A.now + (sp.delay || 0);
    if (th.radio) this._squelch(node, t0 - 0.05, 0.18);

    const syl = bark.v.split('');
    let t = t0;
    syl.forEach((ch, i) => {
      const dur = th.rate * (i === syl.length - 1 ? 1.5 : 1);
      // shouted lines start high and fall away; the last syllable falls hardest
      const from = f0 * (1.16 - i * 0.05);
      const to = f0 * (i === syl.length - 1 ? 0.74 : 1.02 - i * 0.05);
      this._syllable(node, t, dur, VOWELS[ch] || VOWELS.a, from, to, th.vol * sp.gain);
      t += dur * 1.05;
    });
    if (th.radio) this._squelch(node, t + 0.03, 0.13);

    A.mark('voice', (t - A.now) + 0.3);
    return { text: bark.text, dist: sp.dist };
  }

  /** Three parallel formants over a buzzing glottal source. */
  _syllable(dest, t, dur, formants, f0from, f0to, vol) {
    const ctx = this.audio.ctx;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.022);
    out.gain.setValueAtTime(vol, t + dur * 0.62);
    out.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    out.connect(dest);

    /* the consonant — a short unvoiced burst that stops it sounding like a hum */
    const cons = this.audio._noiseSource(1);
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass'; cf.frequency.value = 1900; cf.Q.value = 1.4;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(vol * 0.5, t);
    cg.gain.exponentialRampToValueAtTime(0.0004, t + 0.028);
    cons.connect(cf).connect(cg).connect(dest);
    cons.start(t); cons.stop(t + 0.04);

    /*
     * The source. A sawtooth is a passable glottal pulse — it has the dense
     * harmonic series the formants need something to carve out of. A pure
     * tone through the same filters sounds like a theremin.
     */
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0from, t);
    src.frequency.exponentialRampToValueAtTime(Math.max(40, f0to), t + dur);
    src.start(t); src.stop(t + dur + 0.05);

    formants.forEach((f, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 9 + i * 3;
      const g = ctx.createGain();
      g.gain.value = [1, 0.42, 0.18][i];
      src.connect(bp).connect(g).connect(out);
    });
  }

  /** 300–3400 Hz, the telephone band — what makes it read as a radio net. */
  _radioBand(dest) {
    const ctx = this.audio.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 320; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.7;
    const drive = ctx.createWaveShaper();
    const n = 512, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6) * 0.72;   // squashed, like a cheap handset
    }
    drive.curve = curve;
    hp.connect(lp).connect(drive).connect(dest);
    return hp;
  }

  _squelch(dest, t, vol) {
    const ctx = this.audio.ctx;
    const n = this.audio._noiseSource(1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    n.connect(bp).connect(g).connect(dest);
    n.start(t); n.stop(t + 0.07);
  }
}
