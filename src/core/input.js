/**
 * Keyboard + mouse (pointer lock) + touch.
 *
 * Touch is a first-class path, not a shim: a floating left-thumb stick, a
 * right-thumb look region that works *while* the fire button is held
 * (multi-touch, tracked per identifier), and on-screen buttons that feed the
 * same virtual key set the keyboard writes to — so nothing downstream needs
 * to know which one you're using.
 */

export const IS_TOUCH =
  (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches) ||
  (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 &&
   !matchMedia('(hover: hover)').matches);

const STICK_RADIUS = 62;     // px of travel for full deflection
const SPRINT_AT = 0.86;      // stick deflection that counts as a sprint

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = [false, false, false];
    this.wheel = 0;
    this.locked = false;
    this.sensitivity = 1;
    this.touchSensitivity = 1;
    this.invertY = false;
    this.isTouch = IS_TOUCH;
    this.touch = { active: false, mx: 0, my: 0, fire: false, fireL: false, aim: false,
      lookX: 0, lookY: 0 };
    this._pressed = new Set();
    this._onLockChange = null;

    /* ── keyboard ── */
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._pressed.add(e.code);
      if (['Space', 'Tab', 'KeyR', 'ArrowUp', 'ArrowDown', 'Slash'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.fill(false); });

    /* ── mouse ── */
    canvas.addEventListener('mousedown', (e) => {
      if (this.locked) { this.buttons[e.button] = true; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => { this.buttons[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += (e.movementY || 0) * (this.invertY ? -1 : 1);
    });

    addEventListener('wheel', (e) => {
      if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.buttons.fill(false); }
      this._onLockChange?.(this.locked);
    });

    if (this.isTouch) this._initTouch();
  }

  onLockChange(fn) { this._onLockChange = fn; }

  /** Touch devices never capture the pointer - the controls are on screen. */
  requestLock() {
    if (this.isTouch) { this._onLockChange?.(true); return; }
    if (!this.locked) this.canvas.requestPointerLock?.();
  }
  exitLock() {
    if (this.isTouch) { this._onLockChange?.(false); return; }
    if (this.locked) document.exitPointerLock?.();
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this._pressed.has(code); }

  /** Consume accumulated look delta (radians). */
  takeLook() {
    const s = 0.00022 * this.sensitivity;
    const out = { x: this.mouseDX * s, y: this.mouseDY * s };
    this.mouseDX = 0; this.mouseDY = 0;

    if (this.isTouch) {
      const ts = 0.00185 * this.sensitivity * this.touchSensitivity;
      out.x += this.touch.lookX * ts;
      out.y += this.touch.lookY * ts * (this.invertY ? -1 : 1);
      this.touch.lookX = 0; this.touch.lookY = 0;
    }
    return out;
  }

  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  /** Movement axes in local space: x = strafe (+right), y = forward. */
  moveAxis() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.isTouch) { x += this.touch.mx; y += this.touch.my; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /**
   * Firing.
   *
   * On touch, holding ADS fires on its own. This is the single thing that makes
   * a shooter workable with two thumbs: FIRE and look are both the right thumb,
   * so any layout that needs you to hold FIRE takes your aim away for as long
   * as you are shooting. Aiming down sights is already a deliberate act, so it
   * is a good trigger — and the FIRE button still works for hipfire.
   */
  get firing() {
    return this.buttons[0] || this.touch.fire || this.touch.fireL
      || (this.autoFire && this.isTouch && this.touch.aim);
  }
  get aiming() { return this.buttons[2] || this.touch.aim; }

  endFrame() { this._pressed.clear(); }

  /* ══════════════ touch ══════════════ */
  _initTouch() {
    const t = this.touch;
    t.active = true;
    // free the right thumb by default on touch; switchable in settings
    if (this.autoFire === undefined) this.autoFire = true;
    const root = document.getElementById('touch');
    root?.classList.remove('hidden');
    document.body.classList.add('is-touch');

    const stick = document.getElementById('stick-move');
    const knob = document.getElementById('stick-knob');

    // per-finger bookkeeping: one may be steering while another looks
    let stickId = null, sx = 0, sy = 0;
    let lookId = null, lx = 0, ly = 0;

    const isButton = (el) => el instanceof Element && !!el.closest('.tbtn');

    const onStart = (e) => {
      for (const to of e.changedTouches) {
        if (isButton(to.target)) continue;                 // buttons handle themselves

        // left third of the screen steers; the stick floats to the thumb
        /*
         * The left 44% steers. It is a share of the screen rather than a fixed
         * pixel band so it holds on a 6-inch phone and on a tablet, and it is
         * generous because the stick floats to wherever the thumb lands — there
         * is nothing to hit, so a wider zone costs nothing and a narrower one
         * makes the thumb hunt.
         */
        if (stickId === null && to.clientX < innerWidth * 0.44) {
          stickId = to.identifier;
          sx = to.clientX; sy = to.clientY;
          if (stick) {
            stick.style.left = `${sx}px`;
            stick.style.top = `${sy}px`;
            stick.classList.add('on');
          }
        } else if (lookId === null) {
          lookId = to.identifier;
          lx = to.clientX; ly = to.clientY;
        }
      }
    };

    const onMove = (e) => {
      for (const to of e.changedTouches) {
        if (to.identifier === stickId) {
          let dx = to.clientX - sx, dy = to.clientY - sy;
          const d = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, d / STICK_RADIUS);
          dx = (dx / d) * k; dy = (dy / d) * k;
          t.mx = dx; t.my = -dy;
          if (knob) knob.style.transform = `translate(${dx * STICK_RADIUS}px, ${dy * STICK_RADIUS}px)`;
          // push to the edge to sprint
          if (k > SPRINT_AT) this.keys.add('ShiftLeft'); else this.keys.delete('ShiftLeft');
        } else if (to.identifier === lookId) {
          t.lookX += to.clientX - lx;
          t.lookY += to.clientY - ly;
          lx = to.clientX; ly = to.clientY;
        }
      }
      e.preventDefault();
    };

    const onEnd = (e) => {
      for (const to of e.changedTouches) {
        if (to.identifier === stickId) {
          stickId = null; t.mx = 0; t.my = 0;
          this.keys.delete('ShiftLeft');
          if (knob) knob.style.transform = '';
          stick?.classList.remove('on');
        }
        if (to.identifier === lookId) lookId = null;
      }
    };

    addEventListener('touchstart', onStart, { passive: true });
    addEventListener('touchmove', onMove, { passive: false });
    addEventListener('touchend', onEnd, { passive: true });
    addEventListener('touchcancel', onEnd, { passive: true });

    /* ── buttons ── */
    const el = (id) => document.getElementById(id);

    // held: down while the finger is on it
    const hold = (id, set) => {
      const b = el(id);
      if (!b) return;
      b.addEventListener('touchstart', (e) => {
        set(true); b.classList.add('on'); e.preventDefault(); e.stopPropagation();
      }, { passive: false });
      const off = (e) => { set(false); b.classList.remove('on'); e.preventDefault(); };
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
    };

    // toggled: tap on, tap off
    const toggle = (id, get, set) => {
      const b = el(id);
      if (!b) return;
      b.addEventListener('touchstart', (e) => {
        set(!get()); b.classList.toggle('on', get()); e.preventDefault(); e.stopPropagation();
      }, { passive: false });
    };

    // tapped: fires the matching key for one frame
    const tap = (id, code) => {
      const b = el(id);
      if (!b) return;
      b.addEventListener('touchstart', (e) => {
        this._pressed.add(code);
        this.keys.add(code);
        setTimeout(() => this.keys.delete(code), 80);
        b.classList.add('on');
        setTimeout(() => b.classList.remove('on'), 110);
        e.preventDefault(); e.stopPropagation();
      }, { passive: false });
    };

    /*
     * Two triggers, one flag each, OR-ed at the read. Sharing one flag looks
     * simpler and breaks the moment both are down: releasing either would clear
     * it, so firing with the left thumb and then tapping the right one would
     * stop the gun.
     */
    hold('btn-fire', (v) => (t.fire = v));
    hold('btn-fire-l', (v) => (t.fireL = v));
    toggle('btn-aim', () => t.aim, (v) => (t.aim = v));
    toggle('btn-crouch', () => this.keys.has('ControlLeft'),
      (v) => (v ? this.keys.add('ControlLeft') : this.keys.delete('ControlLeft')));
    tap('btn-jump', 'Space');
    tap('btn-reload', 'KeyR');
    tap('btn-swap', 'KeyX');
    tap('btn-ability', 'KeyE');
    tap('btn-nade', 'KeyG');
  }

  /** Clear any latched touch state (used when a menu opens). */
  releaseAll() {
    this.touch.fire = false;
    this.touch.fireL = false;
    this.touch.aim = false;
    this.touch.mx = 0;
    this.touch.my = 0;
    this.touch.lookX = 0;
    this.touch.lookY = 0;
    this.keys.clear();
    this.buttons.fill(false);
    for (const b of document.querySelectorAll('.tbtn.on')) b.classList.remove('on');
  }
}
