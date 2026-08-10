/**
 * Keyboard + mouse (pointer lock) + touch input.
 * Exposes a per-frame snapshot the rest of the game reads from.
 */
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
    this.invertY = false;
    this.enabled = true;
    this.touch = { active: false, mx: 0, my: 0, fire: false, aim: false };
    this._pressed = new Set();   // edge-triggered, cleared each frame
    this._onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      this.keys.add(c);
      this._pressed.add(c);
      // Don't let the browser scroll / trigger quick-find mid-firefight.
      if (['Space', 'Tab', 'KeyR', 'ArrowUp', 'ArrowDown', 'Slash'].includes(c)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.fill(false); });

    canvas.addEventListener('mousedown', (e) => {
      if (this.locked) { this.buttons[e.button] = true; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => { this.buttons[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
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

    this._initTouch();
  }

  onLockChange(fn) { this._onLockChange = fn; }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }
  exitLock() { if (this.locked) document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }
  /** True only on the frame the key went down. */
  pressed(code) { return this._pressed.has(code); }

  /** Consume accumulated look delta (radians). */
  takeLook() {
    const s = 0.00022 * this.sensitivity;
    const out = { x: this.mouseDX * s, y: this.mouseDY * s };
    this.mouseDX = 0; this.mouseDY = 0;
    if (this.touch.active) {
      out.x += this.touch.lookX * 0.004 * this.sensitivity;
      out.y += this.touch.lookY * 0.004 * this.sensitivity * (this.invertY ? -1 : 1);
      this.touch.lookX = 0; this.touch.lookY = 0;
    }
    return out;
  }

  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  /** Movement axes in local space: x = strafe (+right), y = forward (+fwd). */
  moveAxis() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.touch.active) { x += this.touch.mx; y += this.touch.my; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  get firing() { return this.buttons[0] || this.touch.fire; }
  get aiming() { return this.buttons[2] || this.touch.aim; }

  endFrame() { this._pressed.clear(); }

  /* ── touch ─────────────────────────────────────────────────── */
  _initTouch() {
    const t = this.touch;
    t.lookX = 0; t.lookY = 0;
    const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!isTouch) return;
    t.active = true;
    document.getElementById('touch')?.classList.remove('hidden');

    const stick = document.getElementById('stick-move');
    const knob = stick?.querySelector('i');
    let stickId = null, sx = 0, sy = 0;
    const R = 52;

    stick?.addEventListener('touchstart', (e) => {
      const to = e.changedTouches[0];
      stickId = to.identifier;
      const r = stick.getBoundingClientRect();
      sx = r.left + r.width / 2; sy = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });

    addEventListener('touchmove', (e) => {
      for (const to of e.changedTouches) {
        if (to.identifier === stickId) {
          let dx = to.clientX - sx, dy = to.clientY - sy;
          const d = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, d / R);
          dx = (dx / d) * k; dy = (dy / d) * k;
          t.mx = dx; t.my = -dy;
          if (knob) knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
        } else if (to.identifier === this._lookId) {
          t.lookX += to.clientX - this._lx;
          t.lookY += to.clientY - this._ly;
          this._lx = to.clientX; this._ly = to.clientY;
        }
      }
    }, { passive: false });

    const endTouch = (e) => {
      for (const to of e.changedTouches) {
        if (to.identifier === stickId) {
          stickId = null; t.mx = 0; t.my = 0;
          if (knob) knob.style.transform = '';
        }
        if (to.identifier === this._lookId) this._lookId = null;
      }
    };
    addEventListener('touchend', endTouch);
    addEventListener('touchcancel', endTouch);

    // Right half of the screen = look.
    addEventListener('touchstart', (e) => {
      for (const to of e.changedTouches) {
        if (this._lookId == null && to.clientX > innerWidth * 0.35 &&
            !(to.target instanceof HTMLButtonElement)) {
          this._lookId = to.identifier;
          this._lx = to.clientX; this._ly = to.clientY;
        }
      }
    }, { passive: true });

    const hold = (id, set) => {
      const el = document.getElementById(id);
      el?.addEventListener('touchstart', (e) => { set(true); el.classList.add('on'); e.preventDefault(); }, { passive: false });
      el?.addEventListener('touchend', (e) => { set(false); el.classList.remove('on'); e.preventDefault(); }, { passive: false });
    };
    hold('btn-fire', (v) => (t.fire = v));
    const aimEl = document.getElementById('btn-aim');
    aimEl?.addEventListener('touchstart', (e) => {
      t.aim = !t.aim; aimEl.classList.toggle('on', t.aim); e.preventDefault();
    }, { passive: false });

    const tap = (id, code) => document.getElementById(id)?.addEventListener('touchstart', (e) => {
      this._pressed.add(code); this.keys.add(code);
      setTimeout(() => this.keys.delete(code), 90);
      e.preventDefault();
    }, { passive: false });
    tap('btn-jump', 'Space');
    tap('btn-reload', 'KeyR');
    tap('btn-swap', 'KeyX');
  }
}
