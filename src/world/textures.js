import * as THREE from 'three';
import { makeRNG } from '../core/utils.js';

/**
 * Every texture in the game is painted into a <canvas> at load time. Keeps the
 * repo asset-free and lets the favela palette be generated rather than authored.
 */
function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, x: c.getContext('2d') };
}

function finish(c, repeat = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Speckle noise - the thing that stops big flat boxes looking like plastic. */
function grain(x, size, amount = 14, density = 0.5) {
  const img = x.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.random() > density) continue;
    const n = (Math.random() - 0.5) * amount * 2;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}

/** Grime running down from the top edge - instant "weathered" read. */
function streaks(x, size, rng, count = 18, alpha = 0.09) {
  x.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const px = rng() * size;
    const w = rng.range(1, 5);
    const h = rng.range(size * 0.15, size * 0.9);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(30,24,18,0.9)');
    g.addColorStop(1, 'rgba(30,24,18,0)');
    x.fillStyle = g;
    x.fillRect(px, 0, w, h);
  }
  x.globalAlpha = 1;
}

/* ── brick ─────────────────────────────────────────────────────── */
export function brickTexture(seed = 1) {
  const S = 256, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  x.fillStyle = '#8a8079'; // mortar
  x.fillRect(0, 0, S, S);

  const rows = 8, bh = S / rows, bw = S / 4;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let i = -1; i < 5; i++) {
      const bx = i * bw + off, by = r * bh;
      const shade = rng.range(0.72, 1.05);
      const rr = Math.floor(168 * shade), gg = Math.floor(84 * shade), bb = Math.floor(58 * shade);
      x.fillStyle = `rgb(${rr},${gg},${bb})`;
      x.fillRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
      // hollow-block cavities, very favela
      if (rng.chance(0.55)) {
        x.fillStyle = `rgba(0,0,0,0.16)`;
        x.fillRect(bx + bw * 0.22, by + bh * 0.3, bw * 0.18, bh * 0.4);
        x.fillRect(bx + bw * 0.58, by + bh * 0.3, bw * 0.18, bh * 0.4);
      }
    }
  }
  streaks(x, S, rng, 14, 0.1);
  grain(x, S, 12);
  return finish(c);
}

/* ── painted plaster ───────────────────────────────────────────── */
export function plasterTexture(hex, seed = 1) {
  const S = 256, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  x.fillStyle = hex;
  x.fillRect(0, 0, S, S);

  // patchy repaints
  for (let i = 0; i < 22; i++) {
    x.globalAlpha = rng.range(0.03, 0.1);
    x.fillStyle = rng.chance(0.5) ? '#ffffff' : '#000000';
    const w = rng.range(20, 110), h = rng.range(16, 90);
    x.fillRect(rng() * S, rng() * S, w, h);
  }
  x.globalAlpha = 1;

  // patches where the plaster has fallen off and bare block shows through
  for (let i = 0; i < 5; i++) {
    if (!rng.chance(0.55)) continue;
    x.fillStyle = 'rgba(150,96,70,0.5)';
    const w = rng.range(18, 60), h = rng.range(14, 46);
    const px = rng() * S, py = rng() * S;
    x.beginPath();
    x.ellipse(px, py, w / 2, h / 2, rng() * 3, 0, Math.PI * 2);
    x.fill();
  }
  streaks(x, S, rng, 20, 0.11);
  grain(x, S, 10);
  return finish(c);
}

/* ── corrugated metal roofing ──────────────────────────────────── */
export function corrugatedTexture(seed = 3) {
  const S = 256, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  x.fillStyle = '#7d7a72';
  x.fillRect(0, 0, S, S);
  const period = 16;
  for (let i = 0; i < S; i += period) {
    const g = x.createLinearGradient(i, 0, i + period, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.34)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.34)');
    x.fillStyle = g;
    x.fillRect(i, 0, period, S);
  }
  // rust
  for (let i = 0; i < 40; i++) {
    x.globalAlpha = rng.range(0.05, 0.3);
    x.fillStyle = rng.pick(['#8b4513', '#a0522d', '#6b3410']);
    x.beginPath();
    x.ellipse(rng() * S, rng() * S, rng.range(3, 22), rng.range(3, 14), rng() * 3, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  grain(x, S, 14);
  return finish(c);
}

/* ── concrete ──────────────────────────────────────────────────── */
export function concreteTexture(seed = 5, base = '#9a978f') {
  const S = 256, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  x.fillStyle = base;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    x.globalAlpha = rng.range(0.02, 0.09);
    x.fillStyle = rng.chance(0.5) ? '#ffffff' : '#3a3835';
    x.beginPath();
    x.ellipse(rng() * S, rng() * S, rng.range(6, 44), rng.range(6, 38), rng() * 3, 0, Math.PI * 2);
    x.fill();
  }
  // hairline cracks
  x.globalAlpha = 0.28;
  x.strokeStyle = '#3c3a36';
  for (let i = 0; i < 7; i++) {
    x.lineWidth = rng.range(0.6, 1.8);
    x.beginPath();
    let px = rng() * S, py = rng() * S;
    x.moveTo(px, py);
    for (let s = 0; s < 6; s++) {
      px += rng.range(-30, 30); py += rng.range(-30, 30);
      x.lineTo(px, py);
    }
    x.stroke();
  }
  x.globalAlpha = 1;
  grain(x, S, 12);
  return finish(c);
}

/* ── asphalt / plaza ───────────────────────────────────────────── */
export function asphaltTexture(seed = 7) {
  const S = 256, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  x.fillStyle = '#4a4844';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${rng.int(90, 170)},${rng.int(88, 165)},${rng.int(85, 160)},${rng.range(0.06, 0.3)})`;
    x.fillRect(rng() * S, rng() * S, rng.range(1, 3.5), rng.range(1, 3.5));
  }
  for (let i = 0; i < 30; i++) {
    x.fillStyle = `rgba(20,18,16,${rng.range(0.1, 0.35)})`;
    x.beginPath();
    x.ellipse(rng() * S, rng() * S, rng.range(8, 40), rng.range(6, 30), rng() * 3, 0, Math.PI * 2);
    x.fill();
  }
  grain(x, S, 16);
  return finish(c);
}

/* ── dirt / packed earth ───────────────────────────────────────── */
export function dirtTexture(seed = 11) {
  const S = 256, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  x.fillStyle = '#7a6248';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 300; i++) {
    x.fillStyle = `rgba(${rng.int(70, 150)},${rng.int(55, 120)},${rng.int(35, 90)},${rng.range(0.1, 0.45)})`;
    x.beginPath();
    x.ellipse(rng() * S, rng() * S, rng.range(2, 16), rng.range(2, 12), rng() * 3, 0, Math.PI * 2);
    x.fill();
  }
  grain(x, S, 18);
  return finish(c);
}

/* ── graffiti-tagged wall ──────────────────────────────────────── */
export function graffitiTexture(baseHex, seed = 13) {
  const S = 256, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  x.fillStyle = baseHex;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) {
    x.globalAlpha = rng.range(0.04, 0.1);
    x.fillStyle = rng.chance(0.5) ? '#fff' : '#000';
    x.fillRect(rng() * S, rng() * S, rng.range(20, 90), rng.range(16, 70));
  }
  x.globalAlpha = 1;

  // abstract spray tag - overlapping strokes, no real words
  const palette = ['#ff2d55', '#00e5ff', '#ffd60a', '#39ff14', '#ff6b00', '#ffffff', '#b026ff'];
  const layers = rng.int(2, 3);
  for (let l = 0; l < layers; l++) {
    const col = rng.pick(palette);
    x.strokeStyle = col;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.globalAlpha = rng.range(0.65, 0.95);
    const bx = rng.range(20, 90), by = rng.range(60, 190);
    const scale = rng.range(0.8, 1.5);
    for (let s = 0; s < rng.int(3, 6); s++) {
      x.lineWidth = rng.range(6, 17) * scale;
      x.beginPath();
      let px = bx + s * rng.range(24, 42) * scale;
      let py = by + rng.range(-16, 16);
      x.moveTo(px, py);
      for (let k = 0; k < 3; k++) {
        x.quadraticCurveTo(
          px + rng.range(-26, 30) * scale, py + rng.range(-48, 26) * scale,
          (px += rng.range(6, 30) * scale), (py += rng.range(-30, 30) * scale),
        );
      }
      x.stroke();
    }
    // outline pass
    x.globalAlpha = 0.55;
    x.strokeStyle = '#0d0d0d';
    x.lineWidth = 2;
  }
  x.globalAlpha = 1;
  streaks(x, S, rng, 10, 0.1);
  grain(x, S, 10);
  return finish(c);
}

/* ── window / dark opening ─────────────────────────────────────── */
export function windowTexture(seed = 17) {
  const S = 128, { c, x } = canvas(S);
  const rng = makeRNG(seed);
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#1a1d24');
  g.addColorStop(1, '#0a0c10');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.globalAlpha = 0.14;
  x.fillStyle = '#8fb6d6';
  x.beginPath();
  x.moveTo(0, S); x.lineTo(S * 0.7, 0); x.lineTo(S, 0); x.lineTo(S * 0.3, S);
  x.fill();
  x.globalAlpha = 1;
  x.strokeStyle = '#26221c';
  x.lineWidth = 5;
  x.strokeRect(2, 2, S - 4, S - 4);
  x.beginPath();
  x.moveTo(S / 2, 0); x.lineTo(S / 2, S);
  x.moveTo(0, S / 2); x.lineTo(S, S / 2);
  x.stroke();
  grain(x, S, 8);
  return finish(c);
}

/* ── sky gradient (used on a big inverted sphere) ──────────────── */
export function skyTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = 8; c.height = S;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0.00, '#2b5f9e');
  g.addColorStop(0.32, '#69a7d8');
  g.addColorStop(0.55, '#b8d4e6');
  g.addColorStop(0.72, '#efd9b4');
  g.addColorStop(0.86, '#f0b978');
  g.addColorStop(1.00, '#c98a5a');
  x.fillStyle = g;
  x.fillRect(0, 0, 8, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round blob - muzzle flashes, impact sparks, smoke puffs. */
export function sparkTexture(hex = '#ffd27f') {
  const S = 64, { c, x } = canvas(S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, hex);
  g.addColorStop(1, 'rgba(255,180,80,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bullet hole for decals. */
export function bulletHoleTexture() {
  const S = 64, { c, x } = canvas(S);
  x.clearRect(0, 0, S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(10,8,6,0.95)');
  g.addColorStop(0.35, 'rgba(40,34,28,0.7)');
  g.addColorStop(0.62, 'rgba(200,195,185,0.35)');
  g.addColorStop(1, 'rgba(200,195,185,0)');
  x.fillStyle = g;
  x.beginPath();
  x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Build every texture once and hand back a shared library. */
export function buildTextureLibrary() {
  return {
    brick: brickTexture(2),
    concrete: concreteTexture(5),
    concreteDark: concreteTexture(6, '#6f6c66'),
    corrugated: corrugatedTexture(3),
    asphalt: asphaltTexture(7),
    dirt: dirtTexture(11),
    window: windowTexture(17),
    spark: sparkTexture(),
    smoke: sparkTexture('#cfcfcf'),
    hole: bulletHoleTexture(),
    sky: skyTexture(),
    plaster: FAVELA_COLORS.map((hex, i) => plasterTexture(hex, 100 + i)),
    graffiti: [
      graffitiTexture('#b8ada0', 31),
      graffitiTexture('#8d9c8a', 37),
      graffitiTexture('#c2a58c', 41),
    ],
  };
}

/** The hillside palette: sun-bleached tropical paint over bare block. */
export const FAVELA_COLORS = [
  '#e8c25a', // ochre
  '#d9744a', // terracotta
  '#6fb3a8', // faded teal
  '#c9556a', // rose
  '#7fa8d4', // sky blue
  '#a8c060', // lime
  '#e0a95c', // mango
  '#b58ab5', // lilac
  '#d9d2c2', // bone
  '#5f8f7a', // deep green
  '#e0e0d2', // whitewash
  '#c46b3d', // rust orange
];
