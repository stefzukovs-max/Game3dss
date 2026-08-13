import * as THREE from 'three';
import { TERRACES, WORLD, LANES, STREET_DEPTH } from './favela.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  THE SLUMS KIT
 * ══════════════════════════════════════════════════════════════════
 *
 * The supplied modular pack: thirty-six pieces on a two-metre grid, each one a
 * photo-textured single-room shack, a sheet of corrugated roofing, a slab, or a
 * rooftop water tank. It is the closest thing to the real subject in the whole
 * asset library — the map's own houses get the massing of a hillside right, but
 * every surface on them is a tiled material on a right-angled box, and no
 * amount of tiling produces a wall that has been patched three times.
 *
 * How it is used matters more than that it is used.
 *
 *   **Accretion, not replacement.** The map's houses stay. They carry the
 *   collision, the doorways, the balconies, the external stairs and the
 *   staircases the AI routes through, and all of that is load-bearing. What the
 *   kit adds is what a real hillside adds over thirty years: shacks leaning on
 *   the flank of a bigger house, another room built on somebody's roof, and the
 *   gaps between plots filled in until there are no gaps. That is also the
 *   cheapest way to change how the whole map reads, because the pieces land in
 *   exactly the places the eye goes.
 *
 *   **Solid, and out of the way.** Every piece placed here is a real obstacle,
 *   so the placement respects the rects the map reserved — lanes, the street
 *   band along each terrace, the mouths of the climbs. A shack in the mouth of
 *   a climb silently disconnects a terrace, and the map check would find it
 *   after the fact; not building it is better.
 *
 *   **Measured, not assumed.** The pieces are named A1…G4 and parked on a
 *   display grid, so every one of them is re-based here: the bounding box is
 *   measured, the piece is centred on its own footprint and sat on its own
 *   base, and the placement code then works in metres off the ground.
 *
 * Three pieces are deliberately unused. C1 is an open carport and D3 has two
 * open sides: both read as somewhere you can walk into, and neither a solid box
 * (you cannot) nor no collision at all (you walk through the walls) is honest.
 * They are left out rather than placed wrong.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/*
 * What each piece is. The names carry no meaning — they are the artist's
 * display grid — so the roles were read off a rendered contact sheet
 * (`tools/kit-sheet.mjs`) and written down here, which is the only place in the
 * codebase that knows B2 is a red-brick room and D1 is a sheet of zinc.
 *
 * `w` is a weight, not a size: B2 and G4 are three to twenty times the triangle
 * count of the other rooms, so they appear but do not carry the map.
 */
const ROOMS = [
  { n: 'A6', w: 10 }, { n: 'B3', w: 10 }, { n: 'B5', w: 10 }, { n: 'C3', w: 10 },
  { n: 'C5', w: 10 }, { n: 'D2', w: 8 }, { n: 'D5', w: 10 }, { n: 'E3', w: 10 },
  { n: 'E5', w: 10 }, { n: 'F2', w: 10 }, { n: 'F6', w: 10 }, { n: 'G1', w: 8 },
  { n: 'G2', w: 8 }, { n: 'G4', w: 3 }, { n: 'B2', w: 2 },
];
const LONG = ['F5', 'A4'];        // deeper units, for a plot with room for one
const SHEETS = ['A1', 'C4', 'D1', 'F4'];
const FRAME = 'E1';               // an unfinished top floor: columns and rebar
const TANK = 'B1';
const BLOCK = 'A2';               // a whole small building, tank included

/**
 * The kit is modelled on a two-metre grid and the map is not.
 *
 * A two-metre room is correct for a kit and wrong next to this hillside, whose
 * floors are 2.75 m and whose houses are nine metres across: at native size the
 * pieces read as garden sheds parked between the buildings. Scaled up they read
 * as rooms — a 2.6 m storey, which is about what a self-built one actually is.
 * Everything downstream works off the measured size, so this is the only place
 * the number appears.
 */
const SCALE = 1.3;
const CELL = 2.0 * SCALE;         // the grid a run of shacks steps along

/**
 * Re-base every mesh in the kit so it stands on the origin.
 *
 * The batcher renders a template's meshes through the template root's inverse,
 * so a piece has to be handed over as a group whose child already carries the
 * transform we want — the mesh's authored matrix, with a correction that drops
 * its bounding box onto y = 0 and centres it on x/z. Passing the mesh itself
 * would silently discard its own rotation and scale, and several of these
 * carry both.
 */
function indexKit(kit) {
  kit.updateMatrixWorld(true);
  const pieces = new Map();
  const box = new THREE.Box3();
  const size = new THREE.Vector3();

  kit.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.name) return;
    box.setFromObject(mesh);
    box.getSize(size);
    const norm = new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE).multiply(
      new THREE.Matrix4().makeTranslation(
        -(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2)));

    const group = new THREE.Group();
    const child = new THREE.Mesh(mesh.geometry, mesh.material);
    child.matrixAutoUpdate = false;
    child.matrix.copy(norm).multiply(mesh.matrixWorld);
    group.add(child);
    group.updateMatrixWorld(true);

    pieces.set(mesh.name, {
      name: mesh.name, source: group,
      w: size.x * SCALE, h: size.y * SCALE, d: size.z * SCALE,
    });
  });
  return pieces;
}

/**
 * @param {object} B      the prop batcher
 * @param {object} assets the runtime asset library
 * @param {object} world  the built map: collision + meta
 * @param {object} ctx    shared placement services from the prop pass
 */
export function dressSlums(B, assets, world, ctx) {
  const kit = assets.models?.get('slums:kit');
  if (!kit) return null;

  const { collision, meta } = world;
  const { rng, density, free, claim, ground, surface } = ctx;
  const pieces = indexKit(kit);
  const get = (n) => pieces.get(n) ?? null;
  if (!get('C5')) return null;      // not the kit we were built against

  const roomTotal = ROOMS.reduce((a, r) => a + r.w, 0);
  const room = () => {
    let roll = rng() * roomTotal;
    const hit = ROOMS.find((r) => (roll -= r.w) <= 0) ?? ROOMS[0];
    return get(hit.n);
  };

  /*
   * The routes the map kept clear. Padded, because a shack that only just
   * misses a reserved rect still narrows the lane beside it.
   */
  const reserved = meta.reserved ?? [];
  const blocked = (x, z, pad = 1.4) => reserved.some((r) =>
    x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);

  let placed = 0;
  /*
   * Why candidates were turned away, kept and returned.
   *
   * A pass that samples the map and rejects most of what it samples looks
   * identical from a screenshot whether it is placing everything it can or
   * losing nine in ten to one bad guard, and the two need completely different
   * fixes. `npm run budget` prints this.
   */
  const why = { seeds: 0, routes: 0, occupied: 0, offTerrace: 0, runsCut: 0,
    ring: 0, ringRoutes: 0, ringTaken: 0, ringOff: 0, ringOk: 0 };

  /*
   * Two radii, and the difference between them is what lets a terrace of shacks
   * exist at all. A piece is 2.6 m across, so its real footprint is ~1.8 m of
   * radius and nothing else should come inside that. But a run of shacks steps
   * 2.6 m at a time and each one has to land inside its neighbour's footprint
   * circle, so the *test* is deliberately small and the full claim is only
   * filed once the run is finished. `settle` is that flush.
   */
  const TEST_R = 0.9, HELD_R = 1.75;
  let pending = [];
  const settle = () => { for (const c of pending) claim(c[0], c[1], HELD_R); pending = []; };

  /** Stand a piece with its base on `y`, and make it solid unless told not to. */
  const put = (p, x, y, z, yaw, solid = true) => {
    if (!p) return false;
    _q.setFromAxisAngle(_up, yaw);
    B.placeObject(`slums:${p.name}`, p.source, _m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)));
    if (solid) {
      const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
      collision.addBox(x, y + p.h / 2, z, p.w * c + p.d * sn, p.h, p.w * sn + p.d * c, 'shack');
      pending.push([x, z]);
    }
    placed++;
    return true;
  };

  /**
   * A shack, optionally with something built on top of it.
   *
   * The stack is what makes this read as a favela rather than as a row of
   * sheds: a second room set back and turned, or the concrete frame of a floor
   * that was never finished, and a sheet of zinc or a water tank over whatever
   * ended up on top. Only the rooms are solid — a tank you can shoot past is
   * better than an invisible metre of collision on every roofline.
   */
  const stack = (x, y, z, yaw, allowSecond) => {
    const base = room();
    if (!put(base, x, y, z, yaw)) return false;
    let top = y + base.h;
    let span = Math.min(base.w, base.d);

    if (allowSecond && rng.chance(0.42)) {
      const upper = rng.chance(0.22) ? get(FRAME) : room();
      const jx = rng.range(-0.35, 0.35), jz = rng.range(-0.35, 0.35);
      if (put(upper, x + jx, top, z + jz, yaw + rng.range(-0.35, 0.35))) {
        top += upper.h;
        span = Math.min(span, Math.min(upper.w, upper.d));
      }
    }
    if (rng.chance(0.5)) {
      put(get(SHEETS[rng.int(0, SHEETS.length - 1)]), x, top, z,
        yaw + (rng.chance(0.5) ? 0 : Math.PI / 2), false);
    } else if (rng.chance(0.5)) {
      put(get(TANK), x + rng.range(-0.3, 0.3), top, z + rng.range(-0.3, 0.3),
        rng() * Math.PI * 2, false);
    }
    return span > 0;
  };

  /*
   * Terrace 0 is the plaza: paved, the battalion's staging ground, and the one
   * genuinely open space on the map. Nothing here builds on it — filling the
   * police start with cover would change the fight, not the scenery.
   */
  const onHill = (y) => TERRACES.some((t, i) => i > 0 && Math.abs(t.y - y) < 0.9);

  /* ── 1. the blocks ────────────────────────────────────────────────
   * The pass that gives the map a shape you can read while you are being shot
   * at, and it comes from taking the reserved list literally rather than
   * treating it as an obstacle.
   *
   * Four candidate points in five were being thrown away for landing inside a
   * reserved rect, which looked like an over-strict guard and was not: the
   * three lanes and the street band along each terrace genuinely do cover most
   * of the hillside, because that is the fighting space and the map was built
   * around it. The bare ground in an overhead shot *was* the route network —
   * there was simply nothing standing along it to say so.
   *
   * What is left between those rects is a grid of rectangular blocks, and this
   * builds each one as a continuous ring of shacks with deliberate gaps. That
   * is the whole structural idea, and it is the same one every readable
   * multiplayer map is built on:
   *
   *   · **The lanes become corridors.** A nine-metre gap between two solid
   *     rows of housing is a street you can push or hold. The same gap with
   *     nothing along it is a field, and a field gives a player no information
   *     about where they are or where the fight is.
   *
   *   · **The gaps are chosen, not rolled.** Every block gets one opening per
   *     side, at a position fixed by the block's own coordinates, so the
   *     flanking routes are in the same place every match. Random gaps produce
   *     a map that has to be relearned each round, which reads as noise.
   *
   *   · **The interiors stay open** as courtyards behind the frontage — the
   *     pocket you cut into when the lane is covered.
   *
   * Where the map's own procedural houses already stand on a block edge, the
   * ring runs into them and stops: the height check rejects those cells, and
   * the house becomes that stretch of frontage. That is the intended outcome,
   * not a tolerated one.
   */
  const RING_IN = CELL / 2 + 0.7;      // clear of the reserved corridor
  const GAP = 2;                       // cells left out, per side, for a way in
  const ALLEY = 4.4;                   // between blocks: wide enough to fight in
  const laneX = Object.values(LANES).map((l) => l.x).sort((a, b) => a - b);
  const HALF_LANE = 4.5 + RING_IN;

  /**
   * Cut a span into blocks of about `want` metres with an alley between each.
   *
   * The first version of this ringed the whole band between two lanes as one
   * block — thirty-one metres by twelve. A rectangle that size has a small
   * perimeter and an enormous middle, so it produced a thin scatter of
   * buildings around an empty field, which is the thing being fixed. Blocks
   * have to be small enough that their edges are most of their area.
   */
  const cut = (a, b, want) => {
    const span = b - a;
    if (span < want * 0.7) return span >= CELL * 2 ? [[a, b]] : [];
    const n = Math.max(1, Math.round((span + ALLEY) / (want + ALLEY)));
    const size = (span - ALLEY * (n - 1)) / n;
    if (size < CELL * 2) return [[a, b]];
    return Array.from({ length: n }, (_, i) => {
      const s = a + i * (size + ALLEY);
      return [s, s + size];
    });
  };

  // the x bands between the lanes, plus the two outside them
  const bands = [];
  let x0 = WORLD.x0 + 4;
  for (const lx of laneX) {
    bands.push([x0, lx - HALF_LANE]);
    x0 = lx + HALF_LANE;
  }
  bands.push([x0, WORLD.x1 - 4]);

  const blocks = [];
  for (let ti = 1; ti < TERRACES.length; ti++) {
    const t = TERRACES[ti];
    const tz0 = t.z0 + RING_IN;
    const tz1 = t.z1 - STREET_DEPTH - RING_IN;
    if (tz1 - tz0 < CELL * 2) continue;
    for (const [bx0, bx1] of bands) {
      for (const [cx0, cx1] of cut(bx0, bx1, 15)) {
        for (const [cz0, cz1] of cut(tz0, tz1, 12)) blocks.push([cx0, cx1, cz0, cz1, ti]);
      }
    }
  }

  for (const [bx0, bx1, z0, z1, ti] of blocks) {
    {
      /*
       * One opening per side, placed from the block's own coordinates so it is
       * the same every match. The offsets are coprime-ish multiples that keep
       * the four gaps from lining up into a straight shot through the block.
       */
      const nx = Math.floor((bx1 - bx0) / CELL);
      const nz = Math.floor((z1 - z0) / CELL);
      const key = Math.abs(Math.round(bx0 * 3 + z0 * 7 + ti * 11));
      /*
       * The opening is sized against the wall it is cut into, not fixed.
       *
       * A flat two-cell gap was five metres out of a thirteen-metre wall, so
       * once the blocks were made small enough to be useful, forty per cent of
       * every side was missing and the ring stopped reading as a building at
       * all. Short walls get a single-cell doorway; the shortest get none,
       * because a three-cell wall with a hole in it is not a wall.
       */
      const opening = (n) => (n >= 7 ? GAP : n >= 4 ? 1 : 0);
      const gx = opening(nx), gz = opening(nz - 2);
      const gapN = gx ? key % Math.max(1, nx - gx) : -1;
      const gapS = gx ? (key * 3 + 2) % Math.max(1, nx - gx) : -1;
      const gapW = gz ? (key * 5 + 1) % Math.max(1, nz - 2 - gz) + 1 : -1;
      const gapE = gz ? (key * 7 + 3) % Math.max(1, nz - 2 - gz) + 1 : -1;
      const out = (i, at, n) => at < 0 || i < at || i >= at + n;

      const ring = [];
      for (let i = 0; i < nx; i++) {
        const x = bx0 + CELL * (i + 0.5);
        if (out(i, gapN, gx)) ring.push([x, z0, 0]);
        if (nz > 1 && out(i, gapS, gx)) ring.push([x, z1, Math.PI]);
      }
      for (let i = 1; i < nz - 1; i++) {
        const z = z0 + CELL * (i + 0.5);
        if (z > z1 - CELL / 2) break;
        if (out(i, gapW, gz)) ring.push([bx0, z, Math.PI / 2]);
        if (out(i, gapE, gz)) ring.push([bx1, z, -Math.PI / 2]);
      }

      for (const [x, z, yaw] of ring) {
        if (placed >= 900) break;
        why.ring++;
        if (blocked(x, z, 0.2)) { why.ringRoutes++; continue; }
        if (!free(x, z, TEST_R)) { why.ringTaken++; continue; }
        const y = surface(x, z, 40);
        if (y == null || !onHill(y)) { why.ringOff++; continue; }
        why.ringOk++;
        // a taller unit every so often, so a block is a skyline and not a fence
        stack(x, y, z, yaw + rng.range(-0.03, 0.03), rng.chance(0.34));
      }
      settle();
    }
  }

  /* ── 2. annexes on the flanks of the houses ───────────────────────
   * Hard against a wall, facing out. The map recorded every house it built, so
   * this walks each one's perimeter in two-metre cells and leans a shack on it
   * where there is ground to stand on and nothing else has claimed the spot.
   *
   * The module's own facade is not steered: these pieces have doors and windows
   * on more than one side and no reliable convention for which is the front, so
   * they are turned to the wall they lean on and left at that. Standing them at
   * a guessed angle would put a blank wall out half the time.
   */
  const FACES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const hs of meta.houses ?? []) {
    for (const [dx, dz] of FACES) {
      const along = dx ? hs.d : hs.w;
      const cells = Math.max(1, Math.floor(along / CELL));
      for (let i = 0; i < cells; i++) {
        if (!rng.chance(0.34 * density)) continue;
        const u = ((i + 0.5) / cells - 0.5) * along;
        const off = (dx ? hs.w : hs.d) / 2 + CELL / 2 + 0.1;
        const x = hs.x + dx * off + (dx ? 0 : u);
        const z = hs.z + dz * off + (dz ? 0 : u);
        if (blocked(x, z) || !free(x, z, TEST_R)) continue;
        const y = ground(x, z, hs.y, 0.65);
        if (y == null) continue;
        stack(x, y, z, Math.atan2(dx, dz) + rng.range(-0.06, 0.06), false);
      }
      settle();                     // once per face, not once per shack
    }
  }

  /* ── 3. another room on somebody's roof ───────────────────────────
   * The most characteristic thing a favela does over time, and in a shooter it
   * also does real work: a rooftop with a shack on it is a rooftop with cover
   * on it, and the roofs were the flattest, emptiest surfaces on the map.
   */
  for (const hs of meta.houses ?? []) {
    if (hs.w < 7 || hs.d < 7) continue;
    if (!rng.chance(0.55 * density)) continue;
    for (let n = rng.int(1, 2); n > 0; n--) {
      const x = hs.x + rng.range(-hs.w / 2 + CELL / 2, hs.w / 2 - CELL / 2);
      const z = hs.z + rng.range(-hs.d / 2 + CELL / 2, hs.d / 2 - CELL / 2);
      if (!free(x, z, TEST_R)) continue;
      const y = ground(x, z, hs.roof, 0.7);
      if (y == null) continue;
      stack(x, y, z, rng() * Math.PI * 2, false);
      settle();
    }
  }

  /* ── 4. filling in the gaps between the plots ─────────────────────
   * What the frontage rows leave behind: the pockets between a house and the
   * row in front of it.
   *
   * Seeded rather than laid out: the free space between the plots is whatever
   * shape it happens to be, so candidate points are thrown at the map and the
   * ones that land on a terrace, clear of the routes and clear of everything
   * already placed, become the head of a *run* — two to five shacks stepping
   * along one axis, wall to wall, all on the same ground. Single shacks read as
   * sheds parked in a field. Runs read as a settlement, because that is how one
   * grows: somebody builds against the wall that is already there.
   *
   * The height test is the load-bearing one. `surface` will happily report the
   * roof of a house as ground, and without checking the result against the
   * terrace it belongs to, a third of these would be built in mid-air along
   * somebody's roofline.
   */
  /*
   * Seeded off the houses rather than off the map. A slum grows against what is
   * already standing, and sampling the whole rectangle instead spends every
   * candidate on the empty ground the map deliberately left clear.
   */
  const plots = (meta.houses ?? []).filter((h) => h.y > 1);
  const BUDGET = Math.round(760 * density);
  const seeds = Math.round(170 * density);
  for (let i = 0, guard = 0; i < seeds && guard < seeds * 8 && placed < BUDGET; guard++) {
    let sx, sz;
    if (plots.length && rng.chance(0.75)) {
      const hs = plots[rng.int(0, plots.length - 1)];
      const a = rng() * Math.PI * 2, r = Math.max(hs.w, hs.d) / 2 + rng.range(1.6, 7);
      sx = hs.x + Math.cos(a) * r;
      sz = hs.z + Math.sin(a) * r;
    } else {
      sx = rng.range(WORLD.x0 + 7, WORLD.x1 - 7);
      sz = rng.range(WORLD.z0 + 7, TERRACES[1].z1 - 4);
    }
    if (sx < WORLD.x0 + 6 || sx > WORLD.x1 - 6 || sz < WORLD.z0 + 6) continue;
    why.seeds++;
    if (blocked(sx, sz, 1.8)) { why.routes++; continue; }
    if (!free(sx, sz, TEST_R)) { why.occupied++; continue; }
    const y0 = surface(sx, sz, 40);
    if (y0 == null || !onHill(y0)) { why.offTerrace++; continue; }
    i++;

    // one axis, one yaw: a run of shacks put up against each other is square to
    // itself even when it is not square to anything else on the hill
    const yaw = rng() * Math.PI * 2;
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    const run = rng.int(2, 5);

    for (let k = 0; k < run && placed < BUDGET; k++) {
      const x = sx + ax * CELL * k, z = sz + az * CELL * k;
      // the head of the run already claimed its spot; the rest have to earn one
      if (k > 0 && (blocked(x, z, 1.8) || !free(x, z, TEST_R))) { why.runsCut++; break; }
      const y = k === 0 ? y0 : surface(x, z, 40);
      if (y == null || Math.abs(y - y0) > 0.5 || x < WORLD.x0 + 6 || x > WORLD.x1 - 6) {
        why.runsCut++; break;
      }
      /*
       * A whole small block at the head of a run now and then, where there is
       * room for one. It breaks up a hillside that would otherwise be built
       * entirely out of one cube.
       */
      if (k === 0 && rng.chance(0.07) && get(BLOCK) && free(x, z, 2.2)) {
        put(get(BLOCK), x, y, z, yaw);
        break;
      }
      if (rng.chance(0.16) && get(LONG[0])) put(get(LONG[rng.int(0, LONG.length - 1)]), x, y, z, yaw);
      else stack(x, y, z, yaw, true);
    }
    settle();
  }

  return { placed, ...why };
}
