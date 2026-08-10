import { WORLD, TERRACES, ZONES } from '../world/favela.js';

/**
 * Top-down radar. The static level is rasterised once into an offscreen
 * canvas (buildings only — the terraces themselves would just fill it), then
 * blitted rotated under the live blips each frame.
 */
const PPM = 4;                    // offscreen pixels per metre
const SKIP = new Set(['ground', 'ramp', 'world', 'kerb']);

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.range = 46;              // metres shown from edge to edge
    this.rotate = true;
    this._buildStatic();
  }

  _buildStatic() {
    const w = Math.ceil((WORLD.x1 - WORLD.x0) * PPM);
    const h = Math.ceil((WORLD.z1 - WORLD.z0) * PPM);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');

    // terrace bands, lightest at the top of the hill
    for (let i = 0; i < TERRACES.length; i++) {
      const t = TERRACES[i];
      const shade = 22 + i * 7;
      x.fillStyle = `rgb(${shade},${shade + 3},${shade + 6})`;
      x.fillRect(0, (t.z0 - WORLD.z0) * PPM, w, (t.z1 - t.z0) * PPM);
      x.strokeStyle = 'rgba(255,255,255,0.14)';
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(0, (t.z1 - WORLD.z0) * PPM);
      x.lineTo(w, (t.z1 - WORLD.z0) * PPM);
      x.stroke();
    }

    // buildings
    for (const b of this.world.collision.boxes) {
      if (SKIP.has(b.tag)) continue;
      const hgt = b.y1 - b.y0;
      if (hgt < 1.1) continue;
      const bw = b.x1 - b.x0, bd = b.z1 - b.z0;
      if (bw > 60 || bd > 60) continue;      // terrain slabs / perimeter rock
      const lum = Math.min(120, 46 + hgt * 7);
      x.fillStyle = `rgb(${lum},${lum - 4},${lum - 10})`;
      x.fillRect((b.x0 - WORLD.x0) * PPM, (b.z0 - WORLD.z0) * PPM, bw * PPM, bd * PPM);
    }

    this.static = c;
  }

  /**
   * @param {object} s { player, agents, pickups, revealed, projectiles }
   */
  draw(s) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const R = W / 2;
    const scale = W / this.range;   // screen px per metre
    const p = s.player;

    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    c.arc(R, R, R - 1, 0, Math.PI * 2);
    c.clip();

    c.fillStyle = '#0a0c11';
    c.fillRect(0, 0, W, H);

    const rot = this.rotate ? -p.yaw : 0;

    c.save();
    c.translate(R, R);
    c.rotate(rot);
    c.scale(scale / PPM, scale / PPM);
    c.translate(-(p.pos.x - WORLD.x0) * PPM, -(p.pos.z - WORLD.z0) * PPM);
    c.drawImage(this.static, 0, 0);
    c.restore();

    // ── world→minimap helper ──
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const map = (wx, wz) => {
      const dx = (wx - p.pos.x) * scale;
      const dz = (wz - p.pos.z) * scale;
      return [R + dx * cos - dz * sin, R + dx * sin + dz * cos];
    };

    // zone labels
    c.font = '600 8px Barlow Condensed, sans-serif';
    c.textAlign = 'center';
    for (const z of ZONES) {
      if (z.r < 12) continue;
      const d = Math.hypot(z.x - p.pos.x, z.z - p.pos.z);
      if (d > this.range * 0.55) continue;
      const [sx, sy] = map(z.x, z.z);
      c.fillStyle = 'rgba(255,255,255,0.32)';
      c.fillText(z.name.toUpperCase(), sx, sy);
    }

    // pickups
    for (const it of s.pickups) {
      const [sx, sy] = map(it.mesh.position.x, it.mesh.position.z);
      c.fillStyle = it.type === 'health' ? '#2fd06a' : it.type === 'armor' ? '#4ea3ff' : '#ffc23d';
      c.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }

    // agents
    for (const a of s.agents) {
      if (!a.alive) continue;
      const friendly = a.faction === p.faction;
      const known = friendly || s.revealed || a.revealed > 0 || a.visible === true ||
        a.pos.distanceTo(p.pos) < 18;
      if (!known) continue;

      const [sx, sy] = map(a.pos.x, a.pos.z);
      const dy = a.pos.y - p.pos.y;

      c.save();
      c.translate(sx, sy);
      c.rotate(a.yaw + rot + Math.PI);
      c.beginPath();
      c.moveTo(0, -4.2); c.lineTo(3.1, 3.4); c.lineTo(0, 1.7); c.lineTo(-3.1, 3.4);
      c.closePath();
      c.fillStyle = friendly ? '#4ade80' : a.isBoss ? '#ff2d55' : '#ff5a5a';
      c.globalAlpha = Math.abs(dy) > 5 ? 0.45 : 1;
      c.fill();
      c.restore();

      // above / below indicator
      if (Math.abs(dy) > 5) {
        c.fillStyle = friendly ? '#4ade80' : '#ff5a5a';
        c.font = '700 8px sans-serif';
        c.fillText(dy > 0 ? '▲' : '▼', sx + 6, sy + 3);
      }
    }

    // player
    c.save();
    c.translate(R, R);
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4.2, 5); c.lineTo(0, 2.6); c.lineTo(-4.2, 5);
    c.closePath();
    c.fillStyle = '#ffffff';
    c.fill();
    c.restore();

    // view cone
    c.beginPath();
    c.moveTo(R, R);
    c.arc(R, R, R * 0.9, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    c.closePath();
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.fill();

    c.restore();

    // frame + cardinal N
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(R, R, R - 1, 0, Math.PI * 2);
    c.stroke();

    const nAng = rot - Math.PI / 2;
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = '700 10px Barlow Condensed, sans-serif';
    c.fillText('N', R + Math.cos(nAng) * (R - 9), R + Math.sin(nAng) * (R - 9) + 3.5);
  }
}
