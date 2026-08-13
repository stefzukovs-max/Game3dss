/**
 * The performance overlay.
 *
 * Every number this project has quoted about speed came from a headless
 * Chromium on a software rasteriser, which measures how fast swiftshader is and
 * says nothing about the phone the game is actually for. This is the fix: real
 * numbers, on the real device, read by the person holding it.
 *
 * What it reports and why:
 *
 *   · **p50 and p99 frame time, in milliseconds.** Not average FPS. An average
 *     hides exactly the thing that ruins a shooter — the one frame in fifty
 *     that takes 90 ms and lands while you are tracking a target. p99 is that
 *     frame. Milliseconds rather than FPS because the budget is additive: at
 *     60 fps you have 16.7 ms to spend, and "8 ms" tells you how much is left
 *     in a way that "120 fps" does not.
 *
 *   · **Draw calls and triangles**, straight out of `renderer.info`, read after
 *     the frame rather than before it.
 *
 *   · **Tier and device pixel ratio**, because the first question about any
 *     surprising number is which quality tier the device picked for itself.
 *
 * Off by default and free when off: the sampler does nothing until the overlay
 * is shown.
 */

const BUFFER = 240;          // ~4 s at 60 fps — long enough for a stable p99

export class PerfHUD {
  /** @param {object} game the running game, for renderer + tier */
  constructor(game) {
    this.game = game;
    this.on = false;
    this.times = new Float32Array(BUFFER);
    this.n = 0;
    this.i = 0;
    this._acc = 0;
    this._sorted = new Float32Array(BUFFER);

    this.el = document.createElement('div');
    this.el.id = 'perfhud';
    this.el.hidden = true;
    document.body.appendChild(this.el);

    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { this.toggle(); e.preventDefault(); }
    });
    /*
     * Four fingers, because a phone has no F3 and every one-, two- and
     * three-finger gesture is already the game: one steers, one looks, and a
     * third lands whenever you fire while doing both.
     */
    addEventListener('touchstart', (e) => {
      if (e.touches.length >= 4) this.toggle();
    }, { passive: true });
  }

  toggle(force) {
    this.on = force ?? !this.on;
    this.el.hidden = !this.on;
    if (this.on) { this.n = 0; this.i = 0; this._acc = 0; }
  }

  /** Call once per frame, after the render. */
  sample(dtSeconds) {
    if (!this.on) return;
    const ms = dtSeconds * 1000;
    this.times[this.i] = ms;
    this.i = (this.i + 1) % BUFFER;
    if (this.n < BUFFER) this.n++;

    this._acc += dtSeconds;
    if (this._acc < 0.25) return;      // redraw 4×/s; the DOM is not the point
    this._acc = 0;
    this.el.textContent = this._read();
  }

  _pct(p) {
    const s = this._sorted.subarray(0, this.n);
    const at = Math.min(this.n - 1, Math.max(0, Math.round((this.n - 1) * p)));
    return s[at];
  }

  _read() {
    this._sorted.set(this.times.subarray(0, this.n));
    this._sorted.subarray(0, this.n).sort();
    const p50 = this._pct(0.5), p99 = this._pct(0.99);

    const g = this.game;
    const info = g.renderer?.info?.render ?? { calls: 0, triangles: 0 };
    // budget left in a 60 Hz frame, which is the number that decides what else
    // can be afforded — negative means the device is already missing frames
    const head = (16.7 - p50).toFixed(1);

    return [
      `p50 ${p50.toFixed(1)}ms   p99 ${p99.toFixed(1)}ms   head ${head}ms`,
      `fps ${(1000 / Math.max(p50, 0.01)).toFixed(0)}   draws ${info.calls}   tris ${(info.triangles / 1000).toFixed(0)}k`,
      `tier ${g.quality ?? '?'}   dpr ${(g.renderer?.getPixelRatio?.() ?? 1).toFixed(2)}`
      + `   shadows ${g.renderer?.shadowMap?.enabled ? 'on' : 'off'}`,
      `${innerWidth}×${innerHeight}   n=${this.n}`,
    ].join('\n');
  }
}
