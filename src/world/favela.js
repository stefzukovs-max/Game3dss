import * as THREE from 'three';
import { makeRNG, texturedBox, texturedCylinder, GeometryBatcher } from '../core/utils.js';
import { CollisionWorld } from '../core/collision.js';
import { buildTextureLibrary, FAVELA_COLORS, deriveNormalMap, deriveRoughnessMap } from './textures.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  MAP — "CROSS HILL"
 * ══════════════════════════════════════════════════════════════════
 *
 *  A hillside in five terraces. Police push UP from the plaza (+Z, low);
 *  the crew holds DOWN from the cross at the summit (-Z, high).
 *
 *  ┌──────────────────────────────────────────────────────────┐  -78
 *  │  T4  THE CROSS       [cross · lookout · THE BIG ROOF]    │   crew spawn
 *  ├──────────────────────────────────────────────────────────┤  -42
 *  │  T3  THE ROOFTOPS    [WATER TOWER · DANCEHALL · roofs] │
 *  ├──────────────────────────────────────────────────────────┤  -16
 *  │  T2  THE GRAND STAIR [CHAPEL + bell tower · alleys]   │
 *  ├──────────────────────────────────────────────────────────┤   +6
 *  │  T1  THE MARKET      [CORNER SHOP · THE CAGE (pitch)]      │
 *  ├──────────────────────────────────────────────────────────┤  +30
 *  │  T0  THE PLAZA       [BANDSTAND · squad cars · van stop]    │  police spawn
 *  └──────────────────────────────────────────────────────────┘  +66
 *
 *  THREE LANES, so neither side can be held from one angle:
 *
 *    WEST  x < -22   "THE ALLEYS"  tight alleys, blind corners, short stairs.
 *                                  Fastest, most dangerous, no sightlines.
 *    MID   -22..22   "GRAND STAIR" the staircase spine. Most direct,
 *                                  most exposed; the chapel tower watches it.
 *    EAST  x > 22    "RAMP ROAD"   the vehicle road — long, gentle ramps and
 *                                  the open football cage. Long sightlines,
 *                                  rewards rifles.
 *
 *    + ROOFTOPS      a fourth, vertical lane from T2 upward, reached by the
 *                    external stairs. Flanks every choke but leaves you skylined.
 *
 *  Each terrace transition has one choke per lane (never fewer than three
 *  ways up), and every street band runs the full width so you can rotate
 *  laterally between lanes without going back down.
 */

export const TERRACES = [
  { y: 0.0,  z0: 30,  z1: 66,  id: 'plaza',   name: 'The Plaza' },
  { y: 3.5,  z0: 6,   z1: 30,  id: 'market',  name: 'The Market' },
  { y: 7.0,  z0: -16, z1: 6,   id: 'stairs',  name: 'The Grand Stair' },
  { y: 10.5, z0: -42, z1: -16, id: 'roofs',   name: 'The Rooftops' },
  { y: 14.5, z0: -78, z1: -42, id: 'summit',  name: 'The Cross' },
];

export const WORLD = { x0: -70, x1: 70, z0: -78, z1: 66 };

export const LANES = {
  west: { id: 'west', name: 'The Alleys',    x: -44, x0: -70, x1: -22 },
  mid:  { id: 'mid',  name: 'The Grand Stair', x: 0, x0: -22, x1: 22 },
  east: { id: 'east', name: 'The Ramp Road', x: 44,  x0: 22,  x1: 70 },
};

const FLOOR_H = 2.75;
const STREET_DEPTH = 8.0;

/**
 * Climbs between terraces. `kind`:
 *   'stair' steep steps · 'grand' the wide painted staircase · 'ramp' vehicle slope
 * Hand-placed so the three lanes never line up into one straight sprint.
 */
export const CLIMBS = [
  { to: 1, lane: 'west', x: -46, kind: 'stair' },
  { to: 1, lane: 'mid',  x: 0,   kind: 'grand' },
  { to: 1, lane: 'east', x: 42,  kind: 'ramp'  },

  { to: 2, lane: 'west', x: -38, kind: 'stair' },
  { to: 2, lane: 'mid',  x: 0,   kind: 'grand' },
  { to: 2, lane: 'east', x: 62,  kind: 'ramp'  },   // swings wide around The Cage

  { to: 3, lane: 'west', x: -50, kind: 'stair' },
  { to: 3, lane: 'west', x: -28, kind: 'stair' },
  { to: 3, lane: 'mid',  x: 2,   kind: 'grand' },
  { to: 3, lane: 'east', x: 40,  kind: 'ramp'  },

  { to: 4, lane: 'west', x: -42, kind: 'stair' },
  { to: 4, lane: 'mid',  x: -6,  kind: 'grand' },
  { to: 4, lane: 'mid',  x: 14,  kind: 'stair' },
  { to: 4, lane: 'east', x: 46,  kind: 'ramp'  },
];

/** Named areas for HUD callouts and minimap labels. */
export const ZONES = [
  { id: 'plaza',     name: 'The Plaza',       x: 0,   z: 48,  r: 30 },
  { id: 'bandstand', name: 'The Bandstand',   x: -6,  z: 46,  r: 11 },
  { id: 'vanstop',   name: 'The Van Stop',    x: 40,  z: 54,  r: 12 },
  { id: 'shop',      name: 'The Corner Shop', x: -30, z: 22,  r: 12 },
  { id: 'cage',      name: 'The Cage',        x: 42,  z: 14,  r: 15 },
  { id: 'market',    name: 'The Market',      x: 0,   z: 18,  r: 26 },
  { id: 'chapel',    name: 'The Chapel',      x: -20, z: -4,  r: 13 },
  { id: 'stairs',    name: 'The Grand Stair', x: 0,   z: -4,  r: 16 },
  { id: 'alleys',    name: 'The Alleys',      x: -46, z: -6,  r: 22 },
  { id: 'ramp',      name: 'The Ramp Road',   x: 48,  z: -6,  r: 20 },
  { id: 'watertower', name: 'The Water Tower', x: -2, z: -30, r: 14 },
  { id: 'dancehall', name: 'The Dancehall',   x: 40,  z: -30, r: 15 },
  { id: 'roofs',     name: 'The Rooftops',    x: -40, z: -30, r: 20 },
  { id: 'cross',     name: 'The Cross',       x: 0,   z: -56, r: 18 },
  { id: 'bigroof',   name: 'The Big Roof',    x: -34, z: -58, r: 18 },
  { id: 'lookout',   name: 'The Lookout',     x: 38,  z: -58, r: 18 },
];

export function zoneAt(x, z) {
  let best = null, bd = Infinity;
  for (const zn of ZONES) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d < zn.r && d < bd) { bd = d; best = zn; }
  }
  return best?.name ?? 'The Hill';
}

/* ══════════════════════════════════════════════════════════════════
 *  Builder — batches geometry per material (whole level ≈ 30 draws)
 * ══════════════════════════════════════════════════════════════════ */
class WorldBuilder {
  constructor(collision) {
    this.collision = collision;
    this.batches = new Map();
    this.reserved = [];   // rects landmarks own; procedural houses avoid them
  }

  material(key, make) {
    if (!this.batches.has(key)) {
      this.batches.set(key, { batcher: new GeometryBatcher(), material: make() });
    }
  }

  reserve(x, z, w, d, why = '') {
    this.reserved.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, why });
  }

  isFree(x, z, w, d) {
    const a = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
    for (const r of this.reserved) {
      if (a.x0 < r.x1 && a.x1 > r.x0 && a.z0 < r.z1 && a.z1 > r.z0) return false;
    }
    return true;
  }

  box(matKey, cx, cy, cz, w, h, d, opts = {}) {
    const { solid = true, texScale = 0.5, rotY = 0, tag = 'world' } = opts;
    const b = this.batches.get(matKey);
    if (!b) throw new Error('unknown material ' + matKey);
    const geo = texturedBox(w, h, d, texScale);
    _m.compose(_v.set(cx, cy, cz), _q.setFromAxisAngle(_up, rotY), _s.set(1, 1, 1));
    b.batcher.add(geo, _m);
    geo.dispose();

    if (solid) {
      if (rotY === 0) this.collision.addBox(cx, cy, cz, w, h, d, tag);
      else {
        const c = Math.abs(Math.cos(rotY)), s2 = Math.abs(Math.sin(rotY));
        this.collision.addBox(cx, cy, cz, w * c + d * s2, h, w * s2 + d * c, tag);
      }
    }
  }

  quad(matKey, x, y, z, w, h, rotY, tilt = 0) {
    const b = this.batches.get(matKey);
    const geo = new THREE.PlaneGeometry(w, h);
    _e.set(tilt, rotY, 0, 'YXZ');
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
    b.batcher.add(geo, _m);
    geo.dispose();
  }

  /** Ground-hugging painted marking. */
  floorQuad(matKey, x, y, z, w, d, rotY = 0) {
    const b = this.batches.get(matKey);
    const geo = new THREE.PlaneGeometry(w, d);
    _e.set(-Math.PI / 2, rotY, 0, 'YXZ');
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
    b.batcher.add(geo, _m);
    geo.dispose();
  }

  cylinder(matKey, x, y, z, rTop, rBot, h, seg = 10, opts = {}) {
    const { texScale = 0.5 } = opts;
    const b = this.batches.get(matKey);
    const geo = texturedCylinder(rTop, rBot, h, seg, texScale);
    _m.compose(_v.set(x, y, z), _q.setFromAxisAngle(_up, opts.rotY || 0), _s.set(1, 1, 1));
    b.batcher.add(geo, _m);
    geo.dispose();
    if (opts.solid) this.collision.addBox(x, y, z, rBot * 2, h, rBot * 2, opts.tag || 'world');
  }

  finish(scene) {
    const meshes = [];
    for (const [key, b] of this.batches) {
      if (b.batcher.empty) continue;
      const mesh = new THREE.Mesh(b.batcher.build(), b.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'level:' + key;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

/**
 * Which sheeting a roof gets. Weighted to bare galvanised because that is what
 * most of a real hillside is; the painted variants exist to break up the run.
 */
function roofSheet(rng) {
  const r = rng();
  return r < 0.62 ? 'corrugated' : r < 0.83 ? 'corrugatedRed' : 'corrugatedGreen';
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

/* ══════════════════════════════════════════════════════════════════ */

export function buildFavela(scene, seed = 20240607, onProgress = () => {}, opts = {}) {
  const rng = makeRNG(seed);
  const tex = buildTextureLibrary();
  const collision = new CollisionWorld();
  const B = new WorldBuilder(collision);
  // when real models are available the box-built stand-ins step aside
  B.useModels = !!(opts.assets?.ready && opts.assets.models.size);

  /*
   * PBR materials. `detail` adds a Sobel-derived normal map and a luminance
   * roughness map off the same canvas the albedo came from - real relief with
   * nothing extra to ship. Dropped on the low tier, where the extra texture
   * fetches per fragment cost more than they're worth on a phone.
   */
  const detail = opts.detail !== false;
  const assets = opts.assets?.ready ? opts.assets : null;

  const pbr = (map, o = {}) => () => {
    const { roughness = 0.92, metalness = 0, bump = 2.2, bumpScale = 1,
      rmin = 0.55, rmax = 1.0, roughMap = true, env = 0.62, ...rest } = o;
    const m = new THREE.MeshStandardMaterial({
      map, roughness, metalness, envMapIntensity: env, ...rest });
    if (detail && map) {
      m.normalMap = deriveNormalMap(map, bump);
      m.normalScale = new THREE.Vector2(bumpScale, bumpScale);
      if (roughMap) {
        m.roughnessMap = deriveRoughnessMap(map, rmin, rmax);
        m.roughness = 1;      // the map carries the range; don't scale it down
      }
    }
    return m;
  };

  const col = (color, o = {}) => () => {
    const { roughness = 0.9, metalness = 0, env = 0.62, ...rest } = o;
    return new THREE.MeshStandardMaterial({
      color, roughness, metalness, envMapIntensity: env, ...rest });
  };
  const lam = pbr;   // every registration below goes through the PBR path

  /*
   * ── real surfaces ──
   * When the CC0 pack is present, `scan` swaps a painted canvas texture for a
   * photogrammetry set: albedo, a measured normal map and an ARM map carrying
   * occlusion, roughness and metalness. That is the single biggest difference
   * between this and the procedural build — a Sobel normal derived from a
   * painted albedo can only invent relief that correlates with brightness,
   * whereas a scanned normal knows that mortar is recessed and a dark stain is
   * not. Fall through to the canvas path when the pack is missing.
   *
   * `tile` is metres of real surface per repeat. The map's UVs are already
   * world-scaled at 0.5/m, so `repeat = 2 / tile` puts every surface at its
   * true size no matter what geometry it lands on.
   */
  const scan = (slug, fallback, o = {}) => () => {
    if (!assets) return fallback();
    const entry = assets.manifest.materials.find((m) => m.slug === slug);
    const m = assets.standard(slug, { repeat: 2 / (entry?.tile ?? 1), ...o });
    return m ?? fallback();
  };

  B.material('brick', scan('brick_red', pbr(tex.brick, { bump: 3.0, rmin: 0.72, rmax: 1.0 })));
  B.material('brickAlt', scan('brick_orange', pbr(tex.brick, { bump: 3.0, rmin: 0.72, rmax: 1.0 })));
  B.material('concrete', scan('concrete_wall', pbr(tex.concrete, { bump: 1.6, rmin: 0.7, rmax: 0.98 })));
  B.material('concreteDark', scan('concrete_slab', pbr(tex.concreteDark, { bump: 1.8, rmin: 0.72, rmax: 0.98 })));
  const sheet = (slug) => scan(slug,
    pbr(tex.corrugated, { bump: 3.6, metalness: 0.72, rmin: 0.3, rmax: 0.78, env: 0.95 }),
    { metalness: 0.5 });
  B.material('corrugated', sheet('corrugated'));
  B.material('corrugatedRed', sheet('corrugated_red'));
  B.material('corrugatedGreen', sheet('corrugated_green'));
  B.material('asphalt', scan('asphalt', pbr(tex.asphalt, { bump: 1.4, rmin: 0.78, rmax: 1.0 })));
  B.material('dirt', scan('dirt', pbr(tex.dirt, { bump: 1.8, rmin: 0.88, rmax: 1.0 })));
  B.material('paving', scan('paving_brick', pbr(tex.concrete, { bump: 1.6, rmin: 0.7, rmax: 0.98 })));
  B.material('stair', scan('paving_stone', pbr(tex.concrete, { bump: 1.6, rmin: 0.7, rmax: 0.98 })));
  B.material('azulejo', scan('azulejo', pbr(tex.concrete, { bump: 1.0, rmin: 0.2, rmax: 0.6 })));

  // no scanned equivalent: glazing is emissive and reflective rather than a
  // surface you could photograph flat
  /*
   * `windowDark` is the inside of an opening — not black, because a pure black
   * hole reads as a missing polygon; a very dark warm grey reads as a room
   * with no light on. `trim` is the render band around frames and sills, kept
   * lighter than the wall so the opening has an edge to catch the sun.
   */
  B.material('windowDark', col(0x14161a, { roughness: 0.95 }));
  B.material('trim', scan('plaster_plain', col(0xd8d2c6, { roughness: 0.85 }),
    { color: new THREE.Color(0xd8d2c6) }));
  B.material('window', pbr(tex.window, { bump: 1.0, metalness: 0.55, rmin: 0.06, rmax: 0.3, roughMap: true }));

  /*
   * The hillside's paint palette has to survive the swap. There is no scanned
   * material per colour and there never could be, so painted walls tint one
   * weathered-plaster scan by the palette entry — real dirt and crumbling
   * relief, the authored colour. Every third house instead gets one of the
   * three "render peeling back to brick" scans untinted, because those carry
   * their own colour and are the most characteristic surface on a favela.
   */
  const PEELING = ['plaster_orange', 'plaster_yellow', 'plaster_worn'];
  FAVELA_COLORS.forEach((hex, i) => {
    const canvasFallback = pbr(tex.plaster[i], { bump: 1.5, rmin: 0.66, rmax: 0.97 });
    // every third house peels back to bare block; the rest are tinted render
    B.material('plaster' + i, i % 3 === 2
      ? scan(PEELING[(i / 3 | 0) % PEELING.length], canvasFallback)
      : scan('plaster_plain', canvasFallback, { color: new THREE.Color(hex) }));
  });
  /*
   * The heavily damaged white render. Registered but deliberately unused on
   * houses: its blotches are large enough that tiling them across a wall reads
   * as camouflage rather than as peeling paint. Kept for small surfaces where
   * a single tile covers the whole face.
   */
  B.material('plasterBare', scan('plaster_white',
    pbr(tex.plaster[8], { bump: 1.5, rmin: 0.66, rmax: 0.97 })));

  tex.graffiti.forEach((t, i) => B.material('graf' + i,
    pbr(t, { side: THREE.DoubleSide, bump: 1.2, rmin: 0.5, rmax: 0.95 })));
  B.material('wood', scan('planks', col(0x8a6141, { roughness: 0.88 })));
  B.material('woodDark', scan('planks', col(0x5c3f28, { roughness: 0.9 }),
    { color: new THREE.Color(0x8a7358) }));
  B.material('metal', col(0x8d9199, { metalness: 0.88, roughness: 0.38, env: 1.0 }));
  B.material('metalDark', col(0x3a3f47, { metalness: 0.85, roughness: 0.45, env: 1.0 }));
  B.material('rust', scan('rust', col(0x8b4a2b, { metalness: 0.35, roughness: 0.9 })));
  B.material('tankBlue', scan('plaster_white', col(0x2f6fb0, { roughness: 0.55, metalness: 0.12 }),
    { color: new THREE.Color(0x2f6fb0), roughness: 0.55, metalness: 0 }));
  B.material('tankBlack', col(0x24262b, { roughness: 0.6, metalness: 0.15 }));
  B.material('vegetation', col(0x2f5d34, { roughness: 0.95 }));
  B.material('rock', scan('rock', col(0x3c4a38, { roughness: 1.0 })));
  B.material('copBlue', col(0x1b2a4a, { roughness: 0.42, metalness: 0.2 }));
  B.material('copWhite', col(0xd9dde3, { roughness: 0.45, metalness: 0.15 }));
  B.material('lightRed', col(0xd62828, { emissive: 0xd62828, emissiveIntensity: 2.2, roughness: 0.4 }));
  B.material('lightBlue', col(0x2b6cd6, { emissive: 0x2b6cd6, emissiveIntensity: 2.2, roughness: 0.4 }));
  B.material('glass', col(0x1d2733, { roughness: 0.08, metalness: 0.6, env: 1.3 }));
  B.material('tire', col(0x1c1c1e, { roughness: 0.95 }));
  B.material('paint', scan('concrete_wall', col(0xf0ede2, { side: THREE.DoubleSide }),
    { color: new THREE.Color(0xf0ede2), side: THREE.DoubleSide }));
  B.material('paintYellow', col(0xf2c33d, { side: THREE.DoubleSide }));
  B.material('pitch', col(0x2f6b45, { roughness: 0.92 }));
  B.material('pitchLine', col(0xe8e8e0, { side: THREE.DoubleSide }));
  B.material('fence', col(0x9aa0a6, { transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  B.material('chapel', scan('plaster_plain', col(0xf2ece0, { roughness: 0.85 }),
    { color: new THREE.Color(0xf2ece0) }));
  B.material('chapelTrim', col(0x5b7fb0));
  B.material('cross', scan('concrete_wall', col(0xe8e4d8, { roughness: 0.8 }),
    { color: new THREE.Color(0xe8e4d8) }));
  B.material('speaker', col(0x1a1a1c, { roughness: 0.7 }));
  B.material('bulb', col(0xffe9a8, { emissive: 0xffcc55, emissiveIntensity: 3.0 }));
  B.material('van', col(0xe8e2d0, { roughness: 0.32, metalness: 0.25 }));
  B.material('vanTrim', col(0x3f8f7f));
  ['cloth0', 'cloth1', 'cloth2', 'cloth3'].forEach((k, i) =>
    B.material(k, col([0xe94f37, 0x3ac4c4, 0xf5d547, 0xf1f1e6][i], { side: THREE.DoubleSide })));
  ['awning0', 'awning1', 'awning2'].forEach((k, i) =>
    B.material(k, col([0xd94f4f, 0x3f8f5f, 0x3f6f9f][i], { side: THREE.DoubleSide })));

  const meta = { spawns: { gang: [], police: [] }, cover: [], pickups: [], houses: [], landmarks: [], vehicles: [], foliage: [] };

  onProgress(0.08, 'Carving the hillside…');
  buildTerrain(B, rng);

  onProgress(0.2, 'Laying out the lanes…');
  reserveLanes(B);

  onProgress(0.28, 'Raising the landmarks…');
  buildPlaza(B, rng, meta);
  buildMarket(B, rng, meta);
  buildChapel(B, rng, meta);
  buildWaterTower(B, rng, meta);
  buildDancehall(B, rng, meta);
  buildSummit(B, rng, meta);

  onProgress(0.5, 'Stacking the houses…');
  for (let i = 1; i < TERRACES.length; i++) infillTerrace(B, rng, i, meta);

  onProgress(0.68, 'Pouring the stairs…');
  buildClimbs(B, rng);

  onProgress(0.8, 'Hanging the laundry…');
  buildDressing(B, rng, meta);
  buildBackdrop(B, rng, scene);

  onProgress(0.92, 'Baking geometry…');
  const meshes = B.finish(scene);
  collision.build();

  // The sky is owned by the renderer now (src/core/sky.js): one shader dome
  // that also generates the environment map lighting the whole scene.
  finalizeSpawns(meta, collision);
  return { collision, meshes, tex, meta, seed };
}

/* ── terraces + perimeter ───────────────────────────────────────── */
function buildTerrain(B, rng) {
  const { x0, x1 } = WORLD;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;

  for (const t of TERRACES) {
    const d = t.z1 - t.z0;
    const cz = (t.z0 + t.z1) / 2;
    // Only deep enough to reach past the terrace below - any more and the
    // exposed side becomes a huge blank retaining wall filling the view.
    const h = 6.5;
    const mat = t.id === 'plaza' ? 'paving' : t.id === 'market' ? 'concreteDark' : 'dirt';
    B.box(mat, cx, t.y - h / 2, cz, w, h, d, { texScale: 0.2, tag: 'ground' });
    // faced in block so the drop between terraces reads as built, not carved
    B.box('brick', cx, t.y - 1.9, t.z1 - 0.06, w, 3.8, 0.14, { solid: false, texScale: 0.45 });
  }

  // Retaining lip along each terrace edge, broken by gaps you can drop through.
  for (let i = 1; i < TERRACES.length; i++) {
    const t = TERRACES[i];
    for (let x = x0 + 3; x < x1 - 3; x += 9) {
      if (rng.chance(0.3)) continue;
      if (CLIMBS.some((c) => c.to === i && Math.abs(c.x - (x + 4.5)) < 7)) continue;
      B.box('concreteDark', x + 4.5, t.y + 0.45, t.z1 - 0.4, 8.2, 0.9, 0.8, { texScale: 0.55, tag: 'parapet' });
    }
  }

  // Perimeter: a low rock shoulder rather than a wall of grey. The distant
  // hills and the fog carry the horizon, so this only has to stop the player.
  const zMid = (WORLD.z0 + WORLD.z1) / 2, zLen = WORLD.z1 - WORLD.z0 + 30;
  const wall = (x, y, z, sw, sh, sd) => {
    B.box('rock', x, y, z, sw, sh, sd, { texScale: 0.16 });
    // scrub along the top edge so it reads as hillside
    // Skipped entirely when the model pack is loaded: real palms do this job,
    // and a band of cones behind them just reads as a green fence.
    if (B.useModels) return;
    for (let i = -0.5; i <= 0.5; i += 0.055) {
      const px = x + (sw > sd ? i * sw : 0) + (sw > sd ? 0 : rng.range(-1, 1));
      const pz = z + (sw > sd ? rng.range(-1, 1) : i * sd);
      const bh = rng.range(2.5, 5.5);
      B.cylinder('vegetation', px, y + sh / 2 + bh / 2, pz,
        0.25, rng.range(1.4, 3.0), bh, 6, { rotY: rng() * 3 });
    }
  };
  wall(x0 - 7, 4, zMid, 12, 26, zLen);
  wall(x1 + 7, 4, zMid, 12, 26, zLen);
  wall(cx, 10, WORLD.z0 - 7, w + 34, 26, 12);
  wall(cx, -3, WORLD.z1 + 7, w + 34, 26, 12);
}

/** Keep the three lanes and every climb approach clear of infill housing. */
function reserveLanes(B) {
  for (const lane of Object.values(LANES)) {
    B.reserve(lane.x, (WORLD.z0 + WORLD.z1) / 2, 9, WORLD.z1 - WORLD.z0, 'lane:' + lane.id);
  }
  for (const t of TERRACES) {
    // the street band along the downhill edge - the lateral rotation route
    B.reserve(0, t.z1 - STREET_DEPTH / 2, WORLD.x1 - WORLD.x0, STREET_DEPTH, 'street');
  }
  for (const c of CLIMBS) {
    const t = TERRACES[c.to];
    const { run, width } = climbSpec(c);
    // the flight itself plus landings at both ends
    B.reserve(c.x, t.z1 + run / 2, width + 5, run + 12, 'climb');
  }
}

/* ══════════════ LANDMARK: THE PLAZA (police staging) ══════════════ */
function buildPlaza(B, rng, meta) {
  const t = TERRACES[0];
  B.reserve(-6, 46, 22, 22, 'bandstand');
  B.reserve(40, 54, 20, 16, 'vanstop');

  // road markings up the middle of the plaza
  for (let z = t.z0 + 4; z < t.z1 - 4; z += 6) {
    B.floorQuad('paint', 20, 0.03, z, 0.4, 3.2);
  }
  B.floorQuad('paintYellow', 0, 0.03, t.z0 + 3, WORLD.x1 - WORLD.x0 - 20, 0.5);

  // ── THE BANDSTAND: octagonal, the plaza's cover hub ──
  const cx = -6, cz = 46;
  B.cylinder('concrete', cx, 0.35, cz, 7.4, 7.8, 0.7, 8, { solid: true, tag: 'ground' });
  B.cylinder('concreteDark', cx, 0.78, cz, 6.6, 6.9, 0.18, 8, {});
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = cx + Math.cos(a) * 6.2, pz = cz + Math.sin(a) * 6.2;
    B.box('paint', px, 2.4, pz, 0.32, 3.2, 0.32, { texScale: 1, tag: 'pillar' });
    // low balustrade between columns
    B.box('paint', cx + Math.cos(a + Math.PI / 8) * 6.2, 1.35, cz + Math.sin(a + Math.PI / 8) * 6.2,
      4.6, 0.85, 0.28, { rotY: -a - Math.PI / 8, texScale: 1, tag: 'railing' });
  }
  B.cylinder('corrugated', cx, 4.3, cz, 1.2, 7.6, 1.0, 8, { solid: true, tag: 'roof' });
  B.cylinder('metalDark', cx, 5.1, cz, 0.12, 0.12, 0.9, 6, {});
  meta.landmarks.push({ name: 'The Bandstand', x: cx, z: cz });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    meta.cover.push(new THREE.Vector3(cx + Math.cos(a) * 8.4, 0, cz + Math.sin(a) * 8.4));
  }

  // ── squad cars nosed in at the foot of the hill ──
  const spots = [[-34, 36, 0.15], [-14, 34, -0.1], [10, 36, 0.2], [34, 35, -0.25]];
  spots.forEach(([vx, vz, r], i) => buildPoliceVehicle(B, rng, vx, 0, vz, r, i === 1, meta));

  // ── minibus stop shelter ──
  const kx = 40, kz = 54;
  B.box('concrete', kx, 0.06, kz, 14, 0.12, 5, { texScale: 0.4, tag: 'ground' });
  for (const ox of [-6, 6]) B.box('metalDark', kx + ox, 1.4, kz - 2, 0.16, 2.8, 0.16, { texScale: 1, tag: 'pole' });
  B.box('corrugated', kx, 2.9, kz - 1.4, 13, 0.18, 3.4, { texScale: 0.6, tag: 'roof' });
  B.box('paint', kx, 0.55, kz - 2.6, 11, 0.5, 0.4, { texScale: 1, tag: 'bench' });
  buildVan(B, rng, kx + 2, 0, kz + 4.5, -0.2);
  meta.landmarks.push({ name: 'The Van Stop', x: kx, z: kz });

  // sandbag line the squad forms up behind - never across a staircase mouth
  for (let i = 0; i < 16; i++) {
    const bx = rng.range(WORLD.x0 + 12, WORLD.x1 - 12);
    const bz = t.z0 + rng.range(2, 7);
    if (!B.isFree(bx, bz, 4, 4)) continue;
    B.box('concreteDark', bx, 0.5, bz, rng.range(1.8, 2.8), 1.0, 0.8, { texScale: 0.8, tag: 'barrier' });
    meta.cover.push(new THREE.Vector3(bx, 0, bz + 1.3));
  }

  // low shops around the plaza edge so it isn't a bowl - skipped if they'd
  // land on a staircase approach
  for (const [sx, sz, sw, sd, f] of [[-52, 52, 12, 9, 2], [-56, 36, 10, 8, 1],
    [56, 44, 11, 9, 2], [22, 54, 13, 8, 1], [-24, 58, 12, 8, 2], [58, 20, 10, 9, 2]]) {
    if (!B.isFree(sx, sz, sw + 3, sd + 3)) continue;
    buildHouse(B, rng, sx, 0, sz, sw, sd, f, meta, 0);
    B.reserve(sx, sz, sw + 2, sd + 2, 'shop');
  }
  for (let i = 0; i < 6; i++) {
    const sx = rng.range(-20, 30), sz = rng.range(50, 62);
    if (!B.isFree(sx, sz, 6, 6)) continue;
    buildStall(B, rng, sx, 0, sz);
  }
}

/* ══════════════ LANDMARK: THE MARKET + THE CAGE ══════════════ */
function buildMarket(B, rng, meta) {
  const t = TERRACES[1];

  // ── THE CORNER SHOP: painted, roof reachable, west-mid anchor ──
  const mx = -30, mz = 22;
  B.reserve(mx, mz, 20, 16, 'shop');
  buildHouse(B, rng, mx, t.y, mz, 13, 10, 2, meta, 1, { forceStair: true, wall: 'plaster0' });
  // big awning + produce crates out front
  B.box('awning0', mx, t.y + 3.0, mz + 6.4, 13.5, 0.16, 3.2, { solid: false, texScale: 1 });
  for (const ox of [-6, 0, 6]) B.box('metalDark', mx + ox, t.y + 1.5, mz + 7.7, 0.1, 3.0, 0.1, { solid: false, texScale: 1 });
  for (let i = 0; i < 9; i++) {
    B.box('wood', mx + rng.range(-6, 6), t.y + 0.35, mz + rng.range(5.2, 7.4), 0.9, 0.7, 0.7,
      { texScale: 1, rotY: rng() * 0.6, tag: 'prop' });
  }
  B.quad('graf1', mx, t.y + 3.6, mz + 5.05, 11, 2.6, 0);
  meta.landmarks.push({ name: 'The Corner Shop', x: mx, z: mz });

  // ── THE CAGE: caged concrete pitch, the wide east flank ──
  const px = 42, pz = 14, pw = 30, pd = 14;
  B.reserve(px, pz, pw + 6, pd + 6, 'cage');
  B.box('pitch', px, t.y + 0.04, pz, pw, 0.08, pd, { texScale: 0.3, tag: 'ground' });
  // pitch markings
  B.floorQuad('pitchLine', px, t.y + 0.1, pz, pw - 2, 0.2);
  B.floorQuad('pitchLine', px, t.y + 0.1, pz, 0.2, pd - 2);
  for (const s of [-1, 1]) {
    B.floorQuad('pitchLine', px + s * (pw / 2 - 1), t.y + 0.1, pz, 0.2, pd - 2);
    B.floorQuad('pitchLine', px, t.y + 0.1, pz + s * (pd / 2 - 1), pw - 2, 0.2);
    // goal
    const gx = px + s * (pw / 2 - 1.5);
    B.box('paint', gx, t.y + 1.3, pz, 0.16, 2.6, 0.16, { texScale: 1, tag: 'goal' });
    B.box('paint', gx, t.y + 1.3, pz + 3.4, 0.16, 2.6, 0.16, { texScale: 1, tag: 'goal' });
    B.box('paint', gx, t.y + 2.55, pz + 1.7, 0.16, 0.16, 3.6, { solid: false, texScale: 1 });
  }
  // cage: posts + translucent mesh panels
  const fh = 5.5;
  for (let i = -1; i <= 1; i += 2) {
    for (let x = -pw / 2; x <= pw / 2; x += 5) {
      B.box('metalDark', px + x, t.y + fh / 2, pz + i * pd / 2, 0.18, fh, 0.18, { texScale: 1, tag: 'pole' });
    }
    for (let z = -pd / 2; z <= pd / 2; z += 5) {
      B.box('metalDark', px + i * pw / 2, t.y + fh / 2, pz + z, 0.18, fh, 0.18, { texScale: 1, tag: 'pole' });
    }
    B.quad('fence', px, t.y + fh / 2, pz + i * pd / 2, pw, fh, 0);
    B.quad('fence', px + i * pw / 2, t.y + fh / 2, pz, pd, fh, Math.PI / 2);
  }
  // collision for the cage walls, with a gap on each side to run through
  B.collision.addBox(px - pw / 4 - 2, t.y + fh / 2, pz - pd / 2, pw / 2 - 4, fh, 0.3, 'fence');
  B.collision.addBox(px + pw / 4 + 2, t.y + fh / 2, pz - pd / 2, pw / 2 - 4, fh, 0.3, 'fence');
  B.collision.addBox(px - pw / 4 - 2, t.y + fh / 2, pz + pd / 2, pw / 2 - 4, fh, 0.3, 'fence');
  B.collision.addBox(px + pw / 4 + 2, t.y + fh / 2, pz + pd / 2, pw / 2 - 4, fh, 0.3, 'fence');
  B.collision.addBox(px - pw / 2, t.y + fh / 2, pz, 0.3, fh, pd, 'fence');
  B.collision.addBox(px + pw / 2, t.y + fh / 2, pz, 0.3, fh, pd, 'fence');
  // bleacher steps on the uphill side - elevated firing position
  for (let i = 0; i < 3; i++) {
    B.box('concreteDark', px, t.y + 0.3 + i * 0.55, pz - pd / 2 - 1.4 - i * 1.3,
      pw, 0.6 + i * 1.1, 1.3, { texScale: 0.6, tag: 'bleacher' });
  }
  meta.landmarks.push({ name: 'The Cage', x: px, z: pz });
  meta.cover.push(new THREE.Vector3(px - pw / 2 - 2, t.y, pz), new THREE.Vector3(px + pw / 2 + 2, t.y, pz));
}

/* ══════════════ LANDMARK: THE CHAPEL (nave + bell tower) ══════════════ */
function buildChapel(B, rng, meta) {
  const t = TERRACES[2];
  const cx = -20, cz = -4;
  B.reserve(cx, cz, 20, 20, 'chapel');

  // nave
  B.box('chapel', cx, t.y + 2.6, cz, 9, 5.2, 13, { texScale: 0.4, tag: 'building' });
  B.box('corrugated', cx, t.y + 5.4, cz, 9.8, 0.4, 13.8, { texScale: 0.5, tag: 'roof' });
  B.box('chapelTrim', cx, t.y + 5.85, cz, 9.8, 0.5, 0.4, { texScale: 1, tag: 'parapet' });
  // door + windows
  B.quad('window', cx, t.y + 1.6, cz + 6.55, 1.6, 3.0, 0);
  for (const z of [-4, -1, 2]) {
    B.quad('window', cx - 4.55, t.y + 3.0, cz + z, 1.0, 2.0, -Math.PI / 2);
    B.quad('window', cx + 4.55, t.y + 3.0, cz + z, 1.0, 2.0, Math.PI / 2);
  }

  // ── bell tower: the single best angle onto the grand stair, three ways up ──
  const tx = cx + 0.0, tz = cz - 8.2, th = 12.5;
  B.box('chapel', tx, t.y + th / 2, tz, 4.6, th, 4.6, { texScale: 0.45, tag: 'building' });
  // internal switchback stairs wrapped on the outside so it's contestable
  buildSpiralStair(B, tx, t.y, tz, 2.3, th - 2.2);
  // belfry: open on all four sides
  const by = t.y + th;
  for (const [ox, oz] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]]) {
    B.box('chapel', tx + ox, by + 1.5, tz + oz, 0.5, 3.0, 0.5, { texScale: 1, tag: 'pillar' });
  }
  B.box('concrete', tx, by + 0.12, tz, 5.2, 0.24, 5.2, { texScale: 0.6, tag: 'roof' });
  for (const [ox, oz, w, d] of [[0, -2.4, 5.2, 0.3], [0, 2.4, 5.2, 0.3], [-2.4, 0, 0.3, 5.2], [2.4, 0, 0.3, 5.2]]) {
    B.box('chapelTrim', tx + ox, by + 0.75, tz + oz, w, 1.0, d, { texScale: 1, tag: 'railing' });
  }
  B.box('corrugated', tx, by + 3.3, tz, 5.4, 0.5, 5.4, { texScale: 0.6, tag: 'roof' });
  B.cylinder('rust', tx, by + 1.9, tz, 0.55, 0.7, 0.9, 8, {});   // the bell
  // cross on the peak
  B.box('cross', tx, by + 4.4, tz, 0.22, 1.8, 0.22, { solid: false, texScale: 1 });
  B.box('cross', tx, by + 4.8, tz, 1.0, 0.22, 0.22, { solid: false, texScale: 1 });

  meta.landmarks.push({ name: 'The Chapel', x: cx, z: cz });
  meta.cover.push(new THREE.Vector3(cx + 6, t.y, cz + 5), new THREE.Vector3(cx - 6, t.y, cz - 3));
}

/** Square switchback staircase hugging a tower - four flights per revolution. */
function buildSpiralStair(B, x, baseY, z, r, height) {
  const steps = Math.ceil(height / 0.3);
  const riser = height / steps;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 * (height / 6.5);
    const px = x + Math.cos(a) * (r + 0.9);
    const pz = z + Math.sin(a) * (r + 0.9);
    const top = riser * (i + 1);
    B.box('concreteDark', px, baseY + top / 2, pz, 1.5, top, 1.5,
      { texScale: 0.8, rotY: -a, tag: 'stair' });
  }
}

/* ══════════════ LANDMARK: THE WATER TOWER ══════════════ */
function buildWaterTower(B, rng, meta) {
  const t = TERRACES[3];
  const cx = -2, cz = -30;
  B.reserve(cx, cz, 22, 22, 'watertower');

  // plinth building underneath (pump house) - fightable interior footprint
  B.box('concrete', cx, t.y + 1.9, cz, 9, 3.8, 9, { texScale: 0.4, tag: 'building' });
  B.quad('graf0', cx, t.y + 1.9, cz + 4.55, 8, 2.6, 0);
  B.box('concrete', cx, t.y + 3.95, cz, 9.8, 0.3, 9.8, { texScale: 0.5, tag: 'roof' });

  // four legs + the tank
  const legH = 7.5;
  for (const [ox, oz] of [[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]]) {
    B.box('concreteDark', cx + ox, t.y + 4.1 + legH / 2, cz + oz, 0.7, legH, 0.7, { texScale: 0.8, tag: 'pillar' });
  }
  const tankY = t.y + 4.1 + legH;
  B.box('metal', cx, tankY + 0.2, cz, 9.4, 0.4, 9.4, { texScale: 0.5, tag: 'catwalk' });
  B.cylinder('tankBlue', cx, tankY + 2.6, cz, 4.0, 4.0, 4.4, 14, { solid: true, tag: 'tank' });
  B.cylinder('metal', cx, tankY + 4.95, cz, 2.6, 4.1, 0.5, 14, {});
  // catwalk railing
  for (const [ox, oz, w, d] of [[0, -4.7, 9.4, 0.16], [0, 4.7, 9.4, 0.16], [-4.7, 0, 0.16, 9.4], [4.7, 0, 0.16, 9.4]]) {
    B.box('metalDark', cx + ox, tankY + 0.95, cz + oz, w, 1.1, d, { texScale: 1, tag: 'railing' });
  }
  // access stair from the roof of the pump house up to the catwalk
  buildStraightRun(B, cx + 6.2, t.y + 4.1, cz + 4.6, tankY + 0.4, -1, 1.4);
  // and from the ground up to the pump house roof
  buildStraightRun(B, cx - 6.2, t.y, cz - 4.6, t.y + 4.1, 1, 1.4);

  // faded painted lettering on the tank reads as a real landmark from anywhere
  B.quad('paint', cx, tankY + 2.9, cz + 4.05, 5.0, 1.2, 0);

  meta.landmarks.push({ name: 'The Water Tower', x: cx, z: cz });
  meta.cover.push(new THREE.Vector3(cx + 6, t.y, cz), new THREE.Vector3(cx - 6, t.y, cz));
}

/** A straight flight of steps climbing in +Z (dir 1) or -Z (dir -1). */
function buildStraightRun(B, x, yLow, zStart, yHigh, dir, width = 3.2) {
  const rise = yHigh - yLow;
  if (rise <= 0.1) return;
  const steps = Math.ceil(rise / 0.3);
  const riser = rise / steps;
  const tread = 0.45;
  for (let i = 0; i < steps; i++) {
    const top = riser * (i + 1);
    B.box('concreteDark', x, yLow + top / 2, zStart + dir * (i * tread + tread / 2),
      width, top, tread, { texScale: 0.7, tag: 'stair' });
  }
}

/* ══════════════ LANDMARK: THE DANCEHALL (the party slab) ══════════════ */
function buildDancehall(B, rng, meta) {
  const t = TERRACES[3];
  const cx = 40, cz = -30;
  B.reserve(cx, cz, 26, 22, 'dancehall');

  // raised dance slab
  B.box('concrete', cx, t.y + 0.3, cz, 20, 0.6, 15, { texScale: 0.35, tag: 'ground' });
  // painted floor
  B.floorQuad('paintYellow', cx, t.y + 0.62, cz, 16, 0.3);
  B.floorQuad('paintYellow', cx, t.y + 0.62, cz, 0.3, 11);

  // roof on columns - blocks the skyline, forces close fights
  for (const [ox, oz] of [[-9, -6.5], [9, -6.5], [-9, 6.5], [9, 6.5], [0, -6.5], [0, 6.5]]) {
    B.box('metalDark', cx + ox, t.y + 2.6, cz + oz, 0.28, 5.0, 0.28, { texScale: 1, tag: 'pillar' });
  }
  B.box('corrugated', cx, t.y + 5.2, cz, 21, 0.25, 16, { texScale: 0.5, tag: 'roof' });

  // speaker stacks: the cover that defines the space
  for (const [ox, oz] of [[-9.5, -7.5], [9.5, -7.5], [-9.5, 7.5], [9.5, 7.5]]) {
    for (let i = 0; i < 3; i++) {
      B.box('speaker', cx + ox, t.y + 0.6 + 0.85 + i * 1.7, cz + oz, 1.5, 1.65, 1.2,
        { texScale: 1, tag: 'prop' });
    }
    meta.cover.push(new THREE.Vector3(cx + ox * 1.15, t.y, cz + oz * 1.15));
  }
  // DJ booth
  B.box('woodDark', cx, t.y + 1.15, cz - 6.0, 4.5, 1.1, 1.6, { texScale: 0.8, tag: 'prop' });
  B.box('speaker', cx, t.y + 1.85, cz - 6.0, 2.0, 0.3, 0.9, { solid: false, texScale: 1 });

  // string lights across the ceiling
  for (let i = -3; i <= 3; i++) {
    const z = cz + i * 2.2;
    B.box('metalDark', cx, t.y + 5.0, z, 20, 0.04, 0.04, { solid: false, texScale: 1 });
    for (let k = -4; k <= 4; k++) {
      B.cylinder('bulb', cx + k * 2.2, t.y + 4.85, z, 0.09, 0.09, 0.16, 6, {});
    }
  }
  meta.landmarks.push({ name: 'The Dancehall', x: cx, z: cz });
}

/* ══════════════ LANDMARK: THE CROSS (summit) ══════════════ */
function buildSummit(B, rng, meta) {
  const t = TERRACES[4];
  const cx = 0, cz = -56;
  B.reserve(cx, cz, 26, 24, 'cross');

  // stepped plinth - high ground with a 360° approach
  for (let i = 0; i < 4; i++) {
    const s = 16 - i * 3;
    B.box('concrete', cx, t.y + 0.3 + i * 0.6, cz, s, 0.6 + i * 0.6, s, { texScale: 0.5, tag: 'ground' });
  }
  // the cross itself
  const by = t.y + 2.4;
  B.box('cross', cx, by + 4.2, cz, 1.1, 8.4, 1.1, { texScale: 0.6, tag: 'monument' });
  B.box('cross', cx, by + 6.2, cz, 5.0, 1.1, 1.1, { texScale: 0.6, tag: 'monument' });
  meta.landmarks.push({ name: 'The Cross', x: cx, z: cz });

  // ── THE BIG ROOF: the crew's rooftop HQ, west summit ──
  const hx = -34, hz = -58;
  B.reserve(hx, hz, 26, 22, 'bigroof');
  buildHouse(B, rng, hx, t.y, hz, 16, 13, 3, meta, 4, { forceStair: true, wall: 'plaster3' });
  buildHouse(B, rng, hx + 13, t.y, hz + 8, 9, 8, 2, meta, 4);
  buildHouse(B, rng, hx - 12, t.y, hz - 5, 10, 9, 2, meta, 4, { forceStair: true });
  meta.landmarks.push({ name: 'The Big Roof', x: hx, z: hz });

  // ── THE LOOKOUT: east summit viewpoint over the whole hill ──
  const vx = 38, vz = -58;
  B.reserve(vx, vz, 24, 20, 'lookout');
  B.box('concrete', vx, t.y + 0.35, vz, 18, 0.7, 14, { texScale: 0.4, tag: 'ground' });
  for (let x = -8.5; x <= 8.5; x += 1.7) {
    B.box('paint', vx + x, t.y + 1.25, vz + 7.2, 0.16, 1.1, 0.16, { solid: false, texScale: 1 });
  }
  B.box('paint', vx, t.y + 1.8, vz + 7.2, 18, 0.2, 0.4, { texScale: 1, tag: 'railing' });
  // shade structure + benches
  for (const ox of [-6, 6]) B.box('woodDark', vx + ox, t.y + 2.0, vz - 4, 0.3, 3.2, 0.3, { texScale: 1, tag: 'pole' });
  B.box('awning1', vx, t.y + 3.7, vz - 4, 14, 0.2, 5, { solid: false, texScale: 1 });
  for (const oz of [-1.5, -6.5]) B.box('wood', vx, t.y + 1.05, vz + oz, 8, 0.4, 0.6, { texScale: 1, tag: 'bench' });
  meta.landmarks.push({ name: 'The Lookout', x: vx, z: vz });

  // a wall of stacked houses across the back so the summit has depth
  for (let x = WORLD.x0 + 12; x < WORLD.x1 - 12; x += 13) {
    if (!B.isFree(x, t.z0 + 7, 11, 10)) continue;
    buildHouse(B, rng, x + rng.range(-1, 1), t.y, t.z0 + 7 + rng.range(-1, 1),
      rng.range(9, 11), rng.range(8, 10), rng.int(2, 3), meta, 4);
  }
}

/* ══════════════ procedural infill ══════════════ */
function infillTerrace(B, rng, index, meta) {
  const t = TERRACES[index];
  const bandZ0 = t.z0 + 3;
  const bandZ1 = t.z1 - STREET_DEPTH;
  if (bandZ1 - bandZ0 < 7) return;

  // Dense grid with narrow alleys - a favela is packed, and the tight gaps
  // between blocks are what make the flanking routes interesting.
  const cellW = 9.2;
  const cols = Math.floor((WORLD.x1 - WORLD.x0 - 8) / cellW);
  const rows = Math.max(1, Math.round((bandZ1 - bandZ0) / 9.2));
  const cellD = (bandZ1 - bandZ0) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng.chance(0.07)) continue;                 // the occasional empty lot
      const gx = WORLD.x0 + 4 + c * cellW + cellW / 2 + rng.range(-0.9, 0.9);
      const gz = bandZ0 + r * cellD + cellD / 2 + rng.range(-0.8, 0.8);

      const w = Math.min(cellW - 2.2, rng.range(5.4, 8.2));
      const d = Math.min(cellD - 2.2, rng.range(5.0, 7.8));
      if (w < 4.2 || d < 4.2) continue;
      if (!B.isFree(gx, gz, w + 1.2, d + 1.2)) continue;

      const floors = index >= 3
        ? (rng() < 0.34 ? 1 : rng() < 0.76 ? 2 : 3)
        : (rng() < 0.22 ? 1 : rng() < 0.66 ? 2 : 3);
      buildHouse(B, rng, gx, t.y, gz, w, d, floors, meta, index);
      B.reserve(gx, gz, w + 0.9, d + 0.9, 'house');
    }
  }

  // shacks scattered on the street band for cover rhythm
  for (let i = 0; i < 9; i++) {
    const sx = rng.range(WORLD.x0 + 10, WORLD.x1 - 10);
    const sz = rng.range(bandZ1 + 2, t.z1 - 3);
    if (!B.isFree(sx, sz, 7, 7)) continue;
    buildShack(B, rng, sx, t.y, sz);
    B.reserve(sx, sz, 6, 6, 'shack');
    meta.cover.push(new THREE.Vector3(sx, t.y, sz + 3));
  }
}

/* ── the block house ────────────────────────────────────────────── */
/**
 * Openings.
 *
 * The single biggest reason the old houses read as toys: a window was a flat
 * quad pasted on the wall, and a painted-on rectangle is a sticker no matter
 * how good the texture is. A real opening is a hole with depth — a dark recess
 * set back from the face, a frame around it, and a sill jutting out to catch
 * the sun and throw a shadow line. Three extra boxes per window buys the whole
 * difference, and they merge into the same batch as everything else so they
 * cost no draw calls at all.
 */
function punchWindow(B, rng, px, py, pz, face, nx, nz, ww, wh, opts = {}) {
  const along = (u) => [px + Math.cos(face) * u, pz - Math.sin(face) * u];
  const flat = Math.abs(nz) > 0.5;
  const dims = (aw, ad) => (flat ? [aw, ad] : [ad, aw]);
  const bx = (mat, u, y, aw, ah, ad, inset) => {
    const [cx, cz] = along(u);
    const [sx, sz] = dims(aw, ad);
    B.box(mat, cx + nx * inset, y, cz + nz * inset, sx, ah, sz,
      { solid: false, texScale: 0.9, tag: 'trim' });
  };

  // the recess itself, pushed into the wall so the opening reads as a hole
  bx('windowDark', 0, py, ww, wh, 0.14, -0.10);
  // frame: two jambs, a head and the sill
  const t = 0.075;
  bx('trim', -(ww / 2 + t / 2), py, t, wh + t * 2, 0.13, 0.02);
  bx('trim', (ww / 2 + t / 2), py, t, wh + t * 2, 0.13, 0.02);
  bx('trim', 0, py + wh / 2 + t / 2, ww + t * 2, t, 0.13, 0.02);
  bx('trim', 0, py - wh / 2 - 0.045, ww + t * 3, 0.09, 0.22, 0.06);   // sill, proud

  if (opts.glass !== false) bx('window', 0, py, ww - 0.04, wh - 0.04, 0.02, -0.055);

  // a security grille on about a third of them, which is both accurate and
  // the cheapest way to break up a repeated opening
  if (rng.chance(0.34)) {
    for (let i = 1; i <= 3; i++) {
      bx('metalDark', -ww / 2 + (ww * i) / 4, py, 0.025, wh - 0.05, 0.03, 0.045);
    }
  }
  if (rng.chance(0.22)) {                         // laundry rail under the sill
    bx('metalDark', 0, py - wh / 2 - 0.22, ww + 0.1, 0.035, 0.035, 0.16);
  }
}

/** A doorway: taller, sits on the floor, sometimes a roller shutter instead. */
function punchDoor(B, rng, px, py, pz, face, nx, nz) {
  const flat = Math.abs(nz) > 0.5;
  const dims = (aw, ad) => (flat ? [aw, ad] : [ad, aw]);
  const bx = (mat, u, y, aw, ah, ad, inset) => {
    const [sx, sz] = dims(aw, ad);
    B.box(mat, px + Math.cos(face) * u + nx * inset, y, pz - Math.sin(face) * u + nz * inset,
      sx, ah, sz, { solid: false, texScale: 0.9, tag: 'trim' });
  };
  const dw = 0.95, dh = 2.05, cy = py + dh / 2;
  bx('windowDark', 0, cy, dw, dh, 0.16, -0.11);
  bx(rng.chance(0.5) ? 'wood' : 'metalDark', 0, cy, dw - 0.06, dh - 0.06, 0.05, -0.045);
  const t = 0.08;
  bx('trim', -(dw / 2 + t / 2), cy, t, dh + t, 0.14, 0.02);
  bx('trim', (dw / 2 + t / 2), cy, t, dh + t, 0.14, 0.02);
  bx('trim', 0, cy + dh / 2 + t / 2, dw + t * 2, t, 0.14, 0.02);
  bx('concreteDark', 0, py + 0.04, dw + 0.3, 0.08, 0.34, 0.10);      // step
}

/**
 * A house.
 *
 * Favela houses are accreted rather than designed: a ground floor gets built,
 * then a second is added on top a little larger or a little offset, then a
 * room is tacked onto the side, then an outside staircase to reach the roof
 * that will one day be the next floor. Modelling that accretion — instead of
 * extruding one box per plot — is what stops a street reading as a row of
 * shoeboxes, and it costs nothing because everything still merges into the
 * same batched mesh.
 */
function buildHouse(B, rng, x, baseY, z, w, d, floors, meta, terraceIndex, opts = {}) {
  /*
   * A house draws from its own stream, seeded from its plot.
   *
   * Everything in this map is generated from one shared RNG, so any change to
   * how many numbers a house consumes shifts every staircase, shack and spawn
   * built after it — which is how adding balconies quietly moved a climb into
   * a wall. Seeding per plot makes a house's detail independent of what came
   * before it: the rest of the map is unaffected by anything changed in here,
   * and a given plot looks the same every run.
   */
  const hr = makeRNG(((x * 7349) ^ (z * 9161) ^ (baseY * 733)) >>> 0 || 1);
  const h = floors * FLOOR_H;
  const wallMat = opts.wall || (hr.chance(0.26) ? (hr.chance(0.4) ? 'brickAlt' : 'brick')
    : 'plaster' + hr.int(0, FAVELA_COLORS.length - 1));

  /*
   * A few degrees of yaw. Real plots are not square to a grid, and the eye
   * picks up a perfectly aligned row instantly. Kept small — the collision box
   * grows with rotation, and a large angle would start eating the lanes.
   */
  const rotY = opts.rotY ?? hr.range(-0.055, 0.055);
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const world = (ox, oz) => [x + ox * cos + oz * sin, z - ox * sin + oz * cos];

  // ground mass
  B.box(wallMat, x, baseY + h / 2, z, w, h, d, { rotY, texScale: 0.42, tag: 'building' });

  /*
   * The added floor. Either overhanging the street on a couple of corbels —
   * which is the most characteristic favela silhouette there is — or set back
   * to leave a roof terrace. Different render colour, because it was built in
   * a different year with whatever paint was going.
   */
  let topY = baseY + h;
  let topW = w, topD = d, topX = x, topZ = z;
  if (floors >= 2 && hr.chance(0.62)) {
    const addH = FLOOR_H * hr.range(0.85, 1.0);
    const over = hr.chance(0.55);
    const grow = over ? hr.range(0.5, 1.0) : -hr.range(0.8, 1.8);
    const shiftZ = over ? hr.range(0.3, 0.9) : hr.range(-0.6, 0.6);
    topW = Math.max(2.2, w + grow);
    topD = Math.max(2.2, d + grow * 0.6);
    const [ax, az] = world(hr.range(-0.4, 0.4), shiftZ);
    topX = ax; topZ = az;
    const addMat = hr.chance(0.4) ? 'brick' : 'plaster' + hr.int(0, FAVELA_COLORS.length - 1);
    B.box(addMat, topX, topY + addH / 2, topZ, topW, addH, topD,
      { rotY, texScale: 0.42, tag: 'building' });
    if (over) {
      // corbels under the overhang, so it is carried rather than floating
      for (const u of [-topW * 0.34, topW * 0.34]) {
        const [bx2, bz2] = world(u, topD / 2 - 0.25);
        B.box('concreteDark', bx2, topY - 0.22, bz2, 0.22, 0.44, 0.9,
          { rotY, solid: false, texScale: 1, tag: 'trim' });
      }
    }
    topY += addH;
  }

  /* ── openings, on every exposed face of both masses ── */
  const punchFace = (cx, cz, fw, fd, fromY, nFloors) => {
    for (const face of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const fa = face + rotY;
      const nx = Math.sin(fa), nz = Math.cos(fa);
      const flat = Math.abs(Math.cos(face)) > 0.5;
      const faceW = flat ? fw : fd;
      const off = (flat ? fd : fw) / 2 + 0.02;
      const px = cx + nx * off, pz = cz + nz * off;
      const perFloor = Math.max(1, Math.floor(faceW / 2.9));

      for (let f = 0; f < nFloors; f++) {
        const groundFloor = f === 0 && Math.abs(fromY - baseY) < 0.01;
        for (let i = 0; i < perFloor; i++) {
          if (hr.chance(0.20)) continue;
          const u = ((i + 0.5) / perFloor - 0.5) * faceW * 0.84;
          const [wx, wz] = [px + Math.cos(fa) * u, pz - Math.sin(fa) * u];
          const wy = fromY + f * FLOOR_H;
          // one opening per ground-floor face becomes the door
          if (groundFloor && i === (perFloor >> 1) && hr.chance(0.5)) {
            punchDoor(B, rng, wx, wy + 0.02, wz, fa, nx, nz);
          } else {
            punchWindow(B, rng, wx, wy + 1.62, wz, fa, nx, nz,
              hr.range(0.85, 1.15), hr.range(1.05, 1.35));
          }
        }
      }
    }
  };
  punchFace(x, z, w, d, baseY, Math.min(floors, 2));
  if (topY > baseY + h) punchFace(topX, topZ, topW, topD, baseY + h, 1);

  /*
   * A balcony on the downhill face. Cheap, and it does two things at once: it
   * breaks the wall's silhouette, and it reads as somewhere a person lives
   * rather than a surface with holes in it.
   */
  if (floors >= 2 && hr.chance(0.4)) {
    const by = baseY + FLOOR_H + 0.06;
    const bw = Math.min(w * 0.62, 3.0);
    const [bx2, bz2] = world(hr.range(-0.2, 0.2), d / 2 + 0.55);
    B.box('concreteDark', bx2, by, bz2, bw, 0.14, 1.1, { rotY, solid: false, texScale: 0.8, tag: 'trim' });
    for (let i = 0; i <= 6; i++) {
      const [rx, rz] = world(-bw / 2 + (bw * i) / 6 + (bx2 - x) * 0, d / 2 + 1.05);
      B.box('metalDark', rx, by + 0.48, rz, 0.045, 0.85, 0.045,
        { rotY, solid: false, texScale: 1, tag: 'trim' });
    }
    const [hx, hz] = world(hr.range(-0.2, 0.2), d / 2 + 1.05);
    B.box('metalDark', hx, by + 0.92, hz, bw, 0.055, 0.055, { rotY, solid: false, texScale: 1, tag: 'trim' });
  }

  /*
   * An external staircase up the flank. Every other house on a real hillside
   * has one, because the roof is the next floor's floor and nobody is putting
   * an internal stairwell in until they have to.
   */
  if (floors >= 2 && hr.chance(0.34)) {
    const side = hr.chance(0.5) ? -1 : 1;
    const steps = Math.round(FLOOR_H / 0.26);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const [sx2, sz2] = world(side * (w / 2 + 0.55), -d / 2 + 0.6 + t * (d - 1.2));
      /*
       * Decorative, not solid. These hang off the flank of a house and can
       * land anywhere the plot happens to be — including across the mouth of
       * a staircase, which silently walls off a whole terrace from the AI.
       * They are set dressing for the silhouette; the map's own climbs are the
       * routes, and those are the ones that have to stay walkable.
       */
      B.box('concreteDark', sx2, baseY + 0.13 + i * 0.26, sz2, 1.05, 0.26, (d - 1.2) / steps + 0.06,
        { rotY, solid: false, texScale: 0.9, tag: 'trim' });
    }
    const [lx, lz] = world(side * (w / 2 + 1.1), 0);
    B.box('metalDark', lx, baseY + FLOOR_H * 0.5, lz, 0.05, FLOOR_H, 0.05,
      { rotY, solid: false, texScale: 1, tag: 'trim' });
  }

  // graffiti still goes on last, over whatever ended up on the wall
  for (const face of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    if (!hr.chance(0.22)) continue;
    const fa = face + rotY;
    const nx = Math.sin(fa), nz = Math.cos(fa);
    const flat = Math.abs(Math.cos(face)) > 0.5;
    const faceW = flat ? w : d;
    const off = (flat ? d : w) / 2 + 0.05;
    B.quad('graf' + hr.int(0, 2), x + nx * off, baseY + 1.4, z + nz * off,
      Math.min(faceW * 0.7, 4.5), 2.2, fa);
  }

  // the roof caps the topmost mass, which is the added floor when there is one
  const roofY = topY;
  const rw = topW, rd = topD, rx = topX, rz2 = topZ;
  B.box('concrete', rx, roofY + 0.13, rz2, rw + 0.5, 0.26, rd + 0.5,
    { rotY, texScale: 0.5, tag: 'roof' });

  if (hr.chance(0.72)) {
    const ph = hr.range(0.6, 1.0);
    const pw = rw + 0.5, pd = rd + 0.5;
    for (const [ox, oz, bw, bd] of [
      [0, -pd / 2, pw, 0.26], [0, pd / 2, pw, 0.26],
      [-pw / 2, 0, 0.26, pd], [pw / 2, 0, 0.26, pd]]) {
      if (hr.chance(0.2)) continue;
      const [wx2, wz2] = world(ox, oz);
      B.box(hr.chance(0.5) ? (hr.chance(0.4) ? 'brickAlt' : 'brick') : 'concreteDark',
        wx2 + (rx - x), roofY + 0.26 + ph / 2, wz2 + (rz2 - z),
        bw, ph, bd, { rotY, texScale: 0.6, tag: 'parapet' });
    }
  }

  const roofTop = roofY + 0.26;
  if (hr.chance(0.75)) {
    const tx = rx + hr.range(-rw / 3, rw / 3), tz = rz2 + hr.range(-rd / 3, rd / 3);
    B.cylinder(hr.chance(0.6) ? 'tankBlue' : 'tankBlack', tx, roofTop + 0.75, tz, 0.72, 0.72, 1.5, 12,
      { solid: true, tag: 'prop' });
    B.cylinder('tankBlack', tx, roofTop + 1.56, tz, 0.5, 0.62, 0.16, 12, {});
  }
  if (hr.chance(0.5)) {
    const dx = rx + hr.range(-rw / 3, rw / 3), dz = rz2 + hr.range(-rd / 3, rd / 3);
    B.box('metal', dx, roofTop + 0.4, dz, 0.1, 0.8, 0.1, { solid: false, texScale: 1 });
    B.cylinder('copWhite', dx, roofTop + 0.85, dz, 0.42, 0.42, 0.07, 12, { rotY: rng() * 3 });
  }
  if (hr.chance(0.55)) {
    for (let i = 0; i < hr.int(3, 7); i++) {
      B.box('rust', x + hr.range(-w / 2.4, w / 2.4), roofTop + 0.45, z + hr.range(-d / 2.4, d / 2.4),
        0.06, 0.9, 0.06, { solid: false, texScale: 1 });
    }
  }
  if (hr.chance(0.28)) {
    B.box('woodDark', x + hr.range(-w / 3, w / 3), roofTop + 0.35, z + hr.range(-d / 3, d / 3),
      1.1, 0.7, 0.9, { texScale: 0.8, tag: 'prop' });
    meta.cover.push(new THREE.Vector3(x, roofTop, z));
  }

  if (opts.forceStair || hr.chance(0.45)) buildExternalStair(B, rng, x, baseY, z, w, d, h);

  meta.houses.push({ x, z, w, d, y: baseY, h, roof: roofTop, terraceIndex });
  const hw = w / 2 + 1.0, hd = d / 2 + 1.0;
  for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
    meta.cover.push(new THREE.Vector3(x + ox, baseY, z + oz));
  }
  if (rng.chance(0.35)) meta.pickups.push(new THREE.Vector3(x + hw + 0.7, baseY, z));
  if (rng.chance(0.3)) meta.pickups.push(new THREE.Vector3(x, roofTop, z + hd - 1.5));
}

function buildExternalStair(B, rng, x, baseY, z, w, d, h) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dz] = dirs[rng.int(0, 3)];
  const steps = Math.ceil(h / 0.29);
  const riser = h / steps;
  const tread = 0.42;
  const run = steps * tread;
  const sw = 1.3;

  const sx0 = x + dx * ((dx !== 0 ? w : d) / 2 + 0.1);
  const sz0 = z + dz * ((dx !== 0 ? w : d) / 2 + 0.1);
  if (Math.abs(sx0 + dx * run) > WORLD.x1 - 3) return;
  if (sz0 + dz * run < WORLD.z0 + 3 || sz0 + dz * run > WORLD.z1 - 3) return;

  for (let i = 0; i < steps; i++) {
    const t = run - i * tread - tread / 2;
    const top = riser * (i + 1);
    B.box('concreteDark',
      dx !== 0 ? sx0 + dx * t : x, baseY + top / 2, dz !== 0 ? sz0 + dz * t : z,
      dx !== 0 ? tread : sw, top, dz !== 0 ? tread : sw,
      { texScale: 0.7, tag: 'stair' });
  }
  B.box('concreteDark', sx0 + dx * (tread * 0.6), baseY + h + 0.1, sz0 + dz * (tread * 0.6),
    dx !== 0 ? 1.3 : sw, 0.2, dz !== 0 ? 1.3 : sw, { texScale: 0.7, tag: 'stair' });
}

function buildShack(B, rng, x, baseY, z) {
  const w = rng.range(3.2, 4.8), d = rng.range(3, 4.6), h = rng.range(2.4, 3.0);
  const mat = rng.chance(0.45) ? roofSheet(rng) : rng.chance(0.5) ? 'wood' : 'brick';
  B.box(mat, x, baseY + h / 2, z, w, h, d, { texScale: 0.6, tag: 'shack' });
  B.box(roofSheet(rng), x, baseY + h + 0.1, z, w + 0.7, 0.2, d + 0.7, { texScale: 0.7, tag: 'roof' });
  if (rng.chance(0.5)) B.cylinder('tire', x + w / 2 + 0.1, baseY + h + 0.3, z, 0.5, 0.5, 0.2, 10, {});
}

/* ── the climbs ─────────────────────────────────────────────────── */

/**
 * Dimensions of a climb. The level builder and the navigation graph both read
 * this, so a waypoint can never be placed off the end of a staircase.
 * `divider` is the half-width of the grand stair's central spine, which is
 * solid cover — waypoints have to be routed around it, not through it.
 */
export function climbSpec(c) {
  const rise = TERRACES[c.to].y - TERRACES[c.to - 1].y;
  if (c.kind === 'ramp') {
    const steps = Math.ceil(rise / 0.16);
    return { run: steps * 0.62, width: 8.5, divider: 0 };
  }
  const steps = Math.ceil(rise / 0.29);
  const tread = c.kind === 'grand' ? 0.52 : 0.46;
  return {
    run: steps * tread,
    width: c.kind === 'grand' ? 7.5 : 3.8,
    divider: c.kind === 'grand' ? 0.35 : 0,
  };
}

function buildClimbs(B, rng) {
  for (const c of CLIMBS) {
    const upper = TERRACES[c.to];
    const lower = TERRACES[c.to - 1];
    if (c.kind === 'ramp') buildRamp(B, c.x, lower.y, upper.y, upper.z1);
    else buildStair(B, rng, c.x, lower.y, upper.y, upper.z1, c.kind === 'grand');
  }
}

function buildStair(B, rng, x, yLow, yHigh, zTop, grand) {
  const rise = yHigh - yLow;
  const steps = Math.ceil(rise / 0.29);
  const riser = rise / steps;
  const tread = grand ? 0.52 : 0.46;
  const width = grand ? 7.5 : 3.8;

  for (let i = 0; i < steps; i++) {
    const top = riser * (i + 1);
    const z = zTop + tread * (steps - i) - tread / 2;
    B.box(grand && i % 2 === 0 ? 'paint' : 'stair', x, yLow + top / 2, z, width, top, tread,
      { texScale: 0.7, tag: 'stair' });
  }
  const run = steps * tread;

  if (grand) {
    // central divider - the thing that makes the grand stair survivable
    for (let i = 0; i < steps; i += 1) {
      const top = riser * (i + 1);
      const z = zTop + tread * (steps - i) - tread / 2;
      B.box('brick', x, yLow + top + 0.45, z, 0.7, 0.9, tread, { texScale: 0.8, tag: 'railing' });
    }
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < steps; i += 2) {
      const top = riser * (i + 1);
      const z = zTop + tread * (steps - i) - tread;
      B.box('brick', x + s * (width / 2 + 0.2), yLow + top + 0.45, z, 0.4, 0.9, tread * 2,
        { texScale: 0.7, tag: 'railing' });
    }
  }
  B.box('concrete', x, yLow + 0.08, zTop + run + 1.5, width + 2, 0.16, 3, { texScale: 0.5, tag: 'ground' });
  if (rng.chance(0.7)) {
    B.box('metalDark', x + (width / 2 + 0.8) * rng.sign(), yLow + 2.0, zTop + run + 2.4, 0.15, 4.0, 0.15,
      { texScale: 1, tag: 'pole' });
  }
}

/** Vehicle ramp: risers small enough that it reads and walks like a slope. */
function buildRamp(B, x, yLow, yHigh, zTop) {
  const rise = yHigh - yLow;
  const steps = Math.ceil(rise / 0.16);
  const riser = rise / steps;
  const tread = 0.62;
  const width = 8.5;

  for (let i = 0; i < steps; i++) {
    const top = riser * (i + 1);
    const z = zTop + tread * (steps - i) - tread / 2;
    B.box('asphalt', x, yLow + top / 2, z, width, top, tread, { texScale: 0.35, tag: 'ramp' });
  }
  const run = steps * tread;
  // kerbs - deliberately below step height so they read as trim, not a wall
  for (const s of [-1, 1]) {
    for (let i = 0; i < steps; i += 3) {
      const top = riser * (i + 1);
      const z = zTop + tread * (steps - i) - tread * 1.5;
      B.box('concrete', x + s * (width / 2 + 0.25), yLow + top + 0.16, z, 0.5, 0.32, tread * 3,
        { texScale: 0.6, tag: 'kerb' });
    }
  }
  // centre line
  for (let i = 2; i < steps; i += 6) {
    const top = riser * (i + 1);
    const z = zTop + tread * (steps - i);
    B.floorQuad('paintYellow', x, yLow + top + 0.02, z, 0.35, tread * 3);
  }
}

/* ── props, wires, laundry ──────────────────────────────────────── */
function buildDressing(B, rng, meta) {
  let prev = null;
  for (let i = 0; i < TERRACES.length; i++) {
    const t = TERRACES[i];
    const px = WORLD.x0 + 10 + (i % 2) * 7;
    const pz = t.z1 - 4;
    B.box('woodDark', px, t.y + 4.4, pz, 0.26, 8.8, 0.26, { texScale: 0.8, tag: 'pole' });
    B.box('woodDark', px, t.y + 7.9, pz, 2.1, 0.15, 0.15, { solid: false, texScale: 1 });
    if (rng.chance(0.5)) B.box('metalDark', px + 0.45, t.y + 6.8, pz, 0.55, 0.75, 0.45, { solid: false, texScale: 1 });
    const node = { x: px, y: t.y + 7.8, z: pz };
    if (prev) drawWire(B, prev, node);
    prev = node;
  }

  for (let i = 0; i < 34; i++) {
    const t = TERRACES[rng.int(1, TERRACES.length - 1)];
    const x = rng.range(WORLD.x0 + 12, WORLD.x1 - 12);
    const z = rng.range(t.z0 + 5, t.z1 - 5);
    const y = t.y + rng.range(3.0, 6.0);
    const len = rng.range(4, 9);
    const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
    B.box('metal', x, y, z, rot === 0 ? len : 0.05, 0.05, rot === 0 ? 0.05 : len, { solid: false, texScale: 1 });
    const n = Math.floor(len / 1.1);
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n - 0.5;
      const ch = rng.range(0.5, 1.0);
      B.quad('cloth' + rng.int(0, 3),
        x + (rot === 0 ? u * len : 0), y - ch / 2 - 0.05, z + (rot === 0 ? 0 : u * len),
        rng.range(0.45, 0.78), ch, rot === 0 ? 0 : Math.PI / 2);
    }
  }

  for (let i = 0; i < 95; i++) {
    const t = TERRACES[rng.int(0, TERRACES.length - 1)];
    const x = rng.range(WORLD.x0 + 9, WORLD.x1 - 9);
    const z = rng.range(t.z1 - STREET_DEPTH + 1.5, t.z1 - 1.5);
    const y = t.y;
    if (!B.isFree(x, z, 3, 3)) continue;
    const r = rng();
    if (r < 0.32) {
      B.cylinder(rng.chance(0.5) ? 'rust' : 'tankBlue', x, y + 0.47, z, 0.36, 0.36, 0.94, 10,
        { solid: true, tag: 'prop' });
    } else if (r < 0.66) {
      const s = rng.range(0.7, 1.15);
      B.box('wood', x, y + s / 2, z, s, s, s * rng.range(0.85, 1.2),
        { texScale: 1, rotY: rng() * Math.PI, tag: 'prop' });
      if (rng.chance(0.4)) {
        B.box('wood', x + rng.range(-0.2, 0.2), y + s * 1.5, z, s * 0.9, s, s * 0.9,
          { texScale: 1, rotY: rng() * Math.PI, tag: 'prop' });
      }
    } else {
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) B.cylinder('tire', x, y + 0.12 + k * 0.22, z, 0.48, 0.48, 0.22, 12, {});
      B.collision.addBox(x, y + n * 0.11, z, 0.96, n * 0.22, 0.96, 'prop');
    }
    if (rng.chance(0.25)) meta.cover.push(new THREE.Vector3(x, y, z));
  }

  /*
   * Foliage along the terrace lips. The spots are chosen here, because this is
   * where the map knows which edges are exposed — but the actual planting
   * happens in src/world/props.js when the model pack is loaded, so these read
   * as palms and scrub rather than as green cones. The cone fallback stays for
   * the asset-free build.
   */
  for (let i = 0; i < 55; i++) {
    const t = TERRACES[rng.int(1, TERRACES.length - 1)];
    const x = rng.range(WORLD.x0 + 3, WORLD.x1 - 3);
    const z = t.z1 - rng.range(0.5, 2.5);
    if (B.useModels) { meta.foliage.push({ x, z, y: t.y, seed: rng() }); continue; }
    const bh = rng.range(1.4, 3.2);
    B.cylinder('vegetation', x, t.y - rng.range(0.4, 1.8) + bh / 2, z,
      0.22, rng.range(0.7, 1.8), bh, 6, { rotY: rng() * 3 });
  }
}

function drawWire(B, a, b) {
  const seg = 8, sag = 1.8;
  let prev = a;
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const p = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag,
      z: a.z + (b.z - a.z) * t,
    };
    const len = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    const geo = new THREE.BoxGeometry(0.05, 0.05, len);
    _m.lookAt(_v.set(prev.x, prev.y, prev.z), _v2.set(p.x, p.y, p.z), _up);
    _m.setPosition((p.x + prev.x) / 2, (p.y + prev.y) / 2, (p.z + prev.z) / 2);
    B.batches.get('metalDark').batcher.add(geo, _m);
    geo.dispose();
    prev = p;
  }
}

/* ── vehicles ───────────────────────────────────────────────────── */
/**
 * Brazilian military-police vehicles.
 *
 * Two kinds, because the battalion arrives in two very different things and
 * the difference is the story of the map: a marked patrol pickup at the foot
 * of the hill, and an armoured personnel carrier — the one favela residents
 * call the caveirão — that can actually drive up into the lanes.
 *
 * Both are built from a bonnet / cabin / rear break rather than one box. A
 * single extruded slab with wheels reads as a toy no matter what livery is
 * painted on it; the step down from cabin roof to bonnet is what makes it a
 * vehicle.
 */
function buildPoliceVehicle(B, rng, x, y, z, rotY, armoured, meta) {
  /*
   * The marked patrol car is a real model when the pack is loaded — a hand
   * modelled saloon beats anything assembled from boxes, and a police car is
   * the one vehicle a player looks straight at while spawning. Record the spot
   * and let src/world/props.js instance the glTF there.
   *
   * The armoured carrier stays procedural: there is no CC0 model of one, and
   * a caveirão is specific enough that a generic van would be worse than the
   * boxes.
   */
  if (!armoured && meta) {
    meta.vehicles.push({ x, z, rotY, kind: 'police' });
    if (B.useModels) return;
  }
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const at = (ox, oy, oz) => [x + ox * cos + oz * sin, y + oy, z - ox * sin + oz * cos];
  const put = (mat, ox, oy, oz, w, h, d, o = {}) => {
    const p = at(ox, oy, oz);
    B.box(mat, p[0], p[1], p[2], w, h, d, { rotY, texScale: 0.7, ...o });
  };
  const wheel = (ox, oz, r) => {
    const p = at(ox, r, oz);
    B.cylinder('tire', p[0], p[1], p[2], r, r, 0.28, 12, { rotY: rotY + Math.PI / 2, texScale: 1.4 });
    B.cylinder('metal', p[0], p[1], p[2], r * 0.52, r * 0.52, 0.30, 8, { rotY: rotY + Math.PI / 2, texScale: 1.4 });
  };

  /* Light bar: alternating red and blue heads on a low black spine, which is
   * the read from any distance at which the vehicle is only a few pixels. */
  const lightBar = (oy, oz, width) => {
    put('metalDark', 0, oy, oz, width, 0.05, 0.22, { solid: false });
    for (let i = 0; i < 4; i++) {
      const ox = (i - 1.5) * (width / 4.2);
      put(i < 2 ? 'lightRed' : 'lightBlue', ox, oy + 0.09, oz, width / 4.6, 0.13, 0.24, { solid: false });
    }
  };

  if (armoured) {
    const w = 2.5, len = 6.0;
    // hull: a tall slab-sided box with a sloped nose, riding high on the axles
    put('copBlue', 0, 1.55, 0.2, w, 2.1, len - 1.0, { tag: 'vehicle' });
    put('copBlue', 0, 1.15, -len / 2 + 0.55, w - 0.1, 1.3, 1.2, { tag: 'vehicle' });
    put('metalDark', 0, 0.62, 0, w + 0.06, 0.5, len - 0.6, { solid: false });   // skirt
    // vision blocks and gun ports down the flanks
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        put('glass', side * (w / 2 - 0.02), 2.05, i * 1.4, 0.06, 0.34, 0.5, { solid: false });
        put('metalDark', side * (w / 2 - 0.02), 1.55, i * 1.4 + 0.3, 0.08, 0.16, 0.16, { solid: false });
      }
    }
    put('glass', 0, 1.62, -len / 2 + 0.62, w - 0.55, 0.55, 0.12, { solid: false });  // windscreen slit
    // roof hatch, heavy bumper, light bar
    put('metalDark', 0, 2.66, 0.6, 1.0, 0.14, 1.0, { solid: false });
    put('metalDark', 0, 0.95, -len / 2 + 0.02, w + 0.14, 0.6, 0.28, { solid: false });
    for (const ox of [-0.75, 0.75]) put('metalDark', ox, 1.5, -len / 2 - 0.05, 0.14, 1.4, 0.2, { solid: false });
    lightBar(2.72, -1.4, 1.9);
    for (const ox of [-w / 2, w / 2]) for (const oz of [-1.9, 0.4, 2.2]) wheel(ox, oz, 0.62);
    return;
  }

  /* ── marked patrol pickup ── */
  const w = 2.0, len = 5.0;
  put('copWhite', 0, 0.86, 0.1, w, 0.86, len - 0.4, { tag: 'vehicle' });          // body
  put('copWhite', 0, 0.62, -len / 2 + 0.55, w - 0.12, 0.55, 1.1, { tag: 'vehicle' }); // bonnet
  put('copWhite', 0, 1.62, -0.15, w - 0.14, 0.66, 2.0, { tag: 'vehicle' });        // cabin
  put('glass', 0, 1.66, -1.14, w - 0.30, 0.58, 0.14, { solid: false });            // windscreen
  put('glass', 0, 1.66, 0.86, w - 0.32, 0.52, 0.12, { solid: false });             // rear glass
  for (const side of [-1, 1]) {
    put('glass', side * (w / 2 - 0.09), 1.64, -0.15, 0.10, 0.50, 1.7, { solid: false });
    put('metalDark', side * (w / 2 + 0.02), 1.66, -1.02, 0.16, 0.14, 0.10, { solid: false }); // mirror
  }
  put('metalDark', 0, 1.14, 1.35, w - 0.06, 0.7, 0.14, { solid: false });          // bed headboard
  put('copWhite', 0, 0.98, 1.9, w, 0.5, 0.9, { solid: false });                    // tailgate

  /*
   * Livery. A broad blue band along the flank with a white body above and
   * below it is the PM scheme, and it is what makes the vehicle identifiable
   * as police in one glance rather than as a white pickup.
   */
  for (const side of [-1, 1]) {
    put('copBlue', side * (w / 2 + 0.01), 0.90, 0.1, 0.04, 0.34, len - 0.5, { solid: false });
    put('copBlue', side * (w / 2 + 0.015), 1.62, -0.15, 0.03, 0.16, 1.9, { solid: false });
  }
  put('copBlue', 0, 0.72, -len / 2 + 0.02, w - 0.1, 0.30, 0.06, { solid: false });

  // black bumpers, push bar, grille, lamps
  put('metalDark', 0, 0.52, -len / 2 + 0.04, w + 0.08, 0.34, 0.24, { solid: false });
  put('metalDark', 0, 0.52, len / 2 - 0.06, w + 0.04, 0.30, 0.2, { solid: false });
  put('metalDark', 0, 0.86, -len / 2 - 0.06, w - 0.2, 0.72, 0.12, { solid: false });   // push bar
  for (const ox of [-0.55, 0.55]) put('metalDark', ox, 1.10, -len / 2 - 0.04, 0.12, 1.1, 0.14, { solid: false });
  put('metalDark', 0, 0.86, -len / 2 + 0.02, w - 0.42, 0.24, 0.08, { solid: false });  // grille
  for (const ox of [-0.66, 0.66]) put('bulb', ox, 0.86, -len / 2 + 0.0, 0.34, 0.2, 0.08, { solid: false });
  for (const ox of [-0.72, 0.72]) put('lightRed', ox, 1.02, len / 2 - 0.12, 0.24, 0.24, 0.1, { solid: false });

  lightBar(1.98, -0.15, 1.5);
  for (const ox of [-w / 2, w / 2]) for (const oz of [-1.45, 1.5]) wheel(ox, oz, 0.44);
}

function buildVan(B, rng, x, y, z, rotY) {
  const w = 2.0, len = 4.4, h = 2.0;
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const at = (ox, oy, oz) => [x + ox * cos + oz * sin, y + oy, z - ox * sin + oz * cos];
  let p = at(0, h / 2 + 0.4, 0);
  B.box('van', p[0], p[1], p[2], w, h, len, { rotY, texScale: 0.6, tag: 'vehicle' });
  p = at(0, 0.95, 0);
  B.box('vanTrim', p[0], p[1], p[2], w + 0.05, 0.45, len, { rotY, solid: false, texScale: 0.6 });
  p = at(0, h + 0.05, -len / 2 + 0.55);
  B.box('glass', p[0], p[1], p[2], w - 0.2, 0.85, 0.3, { rotY, solid: false, texScale: 1 });
  for (const ox of [-w / 2, w / 2]) {
    for (const oz of [-len / 2 + 1.0, len / 2 - 1.0]) {
      p = at(ox, 0.4, oz);
      B.cylinder('tire', p[0], p[1], p[2], 0.4, 0.4, 0.24, 10, { rotY: rotY + Math.PI / 2 });
    }
  }
}

function buildStall(B, rng, x, y, z) {
  const w = rng.range(2.8, 4.2), d = rng.range(2.1, 2.9);
  B.box('wood', x, y + 0.45, z, w, 0.9, d, { texScale: 0.8, tag: 'stall' });
  for (const [ox, oz] of [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1],
    [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]]) {
    B.box('woodDark', x + ox, y + 1.3, z + oz, 0.1, 2.6, 0.1, { solid: false, texScale: 1 });
  }
  B.box('awning' + rng.int(0, 2), x, y + 2.64, z, w + 0.8, 0.12, d + 0.8, { solid: false, texScale: 1 });
  for (let i = 0; i < rng.int(2, 5); i++) {
    B.box(['cloth0', 'cloth1', 'cloth2'][rng.int(0, 2)], x + rng.range(-w / 3, w / 3), y + 1.02,
      z + rng.range(-d / 3, d / 3), 0.4, 0.3, 0.4, { solid: false, texScale: 1 });
  }
}

/* ── backdrop ───────────────────────────────────────────────────── */
/**
 * The hills across the valley.
 *
 * These were 24 cones in two flat colours with fog switched off, which is
 * exactly how a horizon reads as cardboard: real distant terrain has no hard
 * silhouette, no saturation and no visible facets, because forty kilometres of
 * air has washed all three out.
 *
 * Three changes fix it. The ridges are built as irregular lathed masses rather
 * than cones, so no two profiles match and none of them come to a point. They
 * are tinted toward the sky at the horizon and given a vertical gradient
 * through vertex colours, so the base of a ridge is hazier than its crest —
 * which is what aerial perspective actually looks like. And they sit in two
 * bands at different distances, so the horizon has depth instead of being one
 * cut-out.
 */
function buildBackdrop(B, rng, scene) {
  const g = new THREE.Group();
  g.name = 'backdrop';

  // unlit on purpose: these are beyond any light that matters, and shading
  // them would only reintroduce the facets the haze is meant to remove
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const haze = new THREE.Color(0x9fb6c4);      // the sky just above the horizon
  const rock = new THREE.Color(0x2f4a57);

  const positions = [];
  const colours = [];
  const push = (p, c) => { positions.push(p.x, p.y, p.z); colours.push(c.r, c.g, c.b); };
  const _a = new THREE.Vector3(), _b2 = new THREE.Vector3(), _c2 = new THREE.Vector3();
  const tint = new THREE.Color();

  /** One ridge: a closed fan of irregular spurs around a centre. */
  const ridge = (cx, cz, radius, height, band) => {
    const seg = 11;
    const rim = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = radius * rng.range(0.62, 1.0);
      rim.push(new THREE.Vector3(cx + Math.cos(a) * rr, -30, cz + Math.sin(a) * rr));
    }
    // a broken crest rather than a single apex
    const crest = [];
    for (let i = 0; i < seg; i++) {
      const a = ((i + 0.5) / seg) * Math.PI * 2;
      const rr = radius * rng.range(0.10, 0.34);
      crest.push(new THREE.Vector3(
        cx + Math.cos(a) * rr, -30 + height * rng.range(0.55, 1.0), cz + Math.sin(a) * rr));
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      _a.copy(rim[i]); _b2.copy(rim[j]); _c2.copy(crest[i]);
      // haze strength: heavier at the base and on the farther band
      const low = tint.copy(rock).lerp(haze, 0.55 + band * 0.28);
      const lowC = low.clone();
      const hiC = tint.copy(rock).lerp(haze, 0.24 + band * 0.30).clone();
      push(_a, lowC); push(_b2, lowC); push(_c2, hiC);
      // fill between adjacent crests so the ridge line is continuous
      _a.copy(crest[i]); _b2.copy(rim[j]); _c2.copy(crest[j]);
      push(_a, hiC); push(_b2, lowC); push(_c2, hiC);
    }
  };

  for (let band = 0; band < 2; band++) {
    const count = band ? 20 : 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.16, 0.16);
      const dist = band ? rng.range(360, 470) : rng.range(230, 320);
      ridge(Math.cos(a) * dist, Math.sin(a) * dist,
        rng.range(60, 130), rng.range(band ? 55 : 35, band ? 150 : 105), band);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -900;          // behind everything, in front of the sky
  g.add(mesh);
  scene.add(g);
}

/* ── spawns ─────────────────────────────────────────────────────── */
function finalizeSpawns(meta, collision) {
  const r = makeRNG(4242);
  const place = (list, tIndex, count) => {
    const t = TERRACES[tIndex];
    let guard = 0;
    while (guard++ < 1400 && list.length < count) {
      const x = r.range(WORLD.x0 + 9, WORLD.x1 - 9);
      const z = r.range(t.z0 + 4, t.z1 - 4);
      const g = collision.groundHeight(x, z, t.y + 1.2, 0.45);
      if (g < t.y - 0.6) continue;
      if (collision.isBlocked(x, g, z, 0.6, 1.8)) continue;
      list.push(new THREE.Vector3(x, g, z));
    }
  };
  place(meta.spawns.gang, 4, 14);
  place(meta.spawns.gang, 3, 8);
  place(meta.spawns.police, 0, 16);
  place(meta.spawns.police, 1, 6);

  const standable = (p) => {
    const g = collision.groundHeight(p.x, p.z, p.y + 1.6, 0.4);
    if (g < p.y - 1.6) return false;
    p.y = g;
    return !collision.isBlocked(p.x, g, p.z, 0.5, 1.7);
  };
  meta.cover = meta.cover.filter(standable);
  meta.pickups = meta.pickups.filter(standable);
}
