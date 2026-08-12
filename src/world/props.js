import * as THREE from 'three';
import { makeRNG } from '../core/utils.js';
import { MONUMENT_H } from './favela.js';
import { dressSlums } from './slums.js';

/**
 * Dresses the hillside with the CC0 photogrammetry props.
 *
 * The map's own geometry is boxes: it gets the shape of a favela right, but
 * every silhouette is a right angle. What a real hillside actually looks like
 * from a doorway is the clutter — gas bottles, water drums, tyres, wire, a
 * chair outside a bar, an air conditioner bolted through a wall — and that is
 * exactly the category where scanned assets are unbeatable and cheap.
 *
 * Two rules shape everything here:
 *
 *   Instanced, not cloned. Every placement of a prop shares one InstancedMesh
 *   per source mesh, so forty gas bottles are one draw call and forty matrices
 *   rather than forty draws. Without that, dressing the map properly would
 *   cost more frame time than the entire level geometry does.
 *
 *   Placed against the collision world, not against a wishlist of coordinates.
 *   Ground height is sampled where the prop lands and rejected if the spot is
 *   already solid, so nothing floats, nothing intersects a staircase, and the
 *   layout survives changes to the map underneath it.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/**
 * Collects placements per prop and bakes them into InstancedMeshes at the end.
 */
class PropBatcher {
  constructor(assets, scene, collision) {
    this.assets = assets;
    this.scene = scene;
    this.collision = collision;
    this.queued = new Map();     // key → { source: Object3D, matrices: Matrix4[] }
    this.count = 0;
  }

  /**
   * @param {string} id      prop id from the manifest
   * @param {string} [part]  named sub-object, for the modular kits
   * @returns {THREE.Object3D|null} the template, for measuring before placing
   */
  template(id, part) {
    const root = this.assets.props.get(id);
    if (!root) return null;
    return part ? (root.getObjectByName(part) ?? null) : root;
  }

  /** World-space size of a template, so placement can reason in metres. */
  measure(id, part) {
    const t = this.template(id, part);
    if (!t) return null;
    t.updateMatrixWorld(true);
    _box.setFromObject(t);
    return { size: _box.getSize(_size).clone(), min: _box.min.clone(), max: _box.max.clone() };
  }

  /**
   * Queue one placement. `matrix` is the world transform of the template's
   * own origin, so callers work in the prop's authored coordinates.
   */
  place(id, part, matrix) {
    const t = this.template(id, part);
    if (!t) return false;
    const key = part ? `${id}#${part}` : id;
    let e = this.queued.get(key);
    if (!e) this.queued.set(key, (e = { source: t, matrices: [] }));
    e.matrices.push(matrix.clone());
    this.count++;
    return true;
  }

  /**
   * Place a template the batcher did not resolve from the prop map — the
   * weapon and vehicle models live in a different collection, but they batch
   * exactly the same way.
   */
  placeObject(key, source, matrix) {
    if (!source) return false;
    let e = this.queued.get(key);
    if (!e) this.queued.set(key, (e = { source, matrices: [] }));
    e.matrices.push(matrix.clone());
    this.count++;
    return true;
  }

  /** Convenience: stand a prop upright at a point with a yaw and scale. */
  stand(id, part, x, y, z, yaw = 0, scale = 1) {
    _q.setFromAxisAngle(_up, yaw);
    return this.place(id, part, _m.compose(_v.set(x, y, z), _q, _s.set(scale, scale, scale)));
  }

  /**
   * Flatten every queued placement into InstancedMeshes.
   *
   * A template can be a group of several meshes with their own local
   * transforms, so each source mesh gets its own InstancedMesh and each
   * instance matrix is the placement composed with that mesh's transform
   * relative to the template root.
   */
  build() {
    const root = new THREE.Group();
    root.name = 'props';
    let draws = 0;

    for (const [key, { source, matrices }] of this.queued) {
      source.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(source.matrixWorld).invert();

      source.traverse((o) => {
        if (!o.isMesh) return;
        const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        const inst = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
        inst.name = `prop:${key}`;
        inst.castShadow = true;
        inst.receiveShadow = true;
        for (let i = 0; i < matrices.length; i++) {
          inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(matrices[i], local));
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        root.add(inst);
        draws++;
      });
    }

    this.scene.add(root);
    return { root, draws, placements: this.count };
  }
}

/**
 * How many props the tier can afford. The cost is draw calls and shadow-map
 * geometry, not download — the pack is already in memory by this point.
 */
const BUDGET = { low: 0.28, medium: 0.6, high: 1 };

export function scatterProps(scene, assets, world, opts = {}) {
  if (!assets?.ready || !assets.props.size) return null;

  const { collision, meta } = world;
  const rng = makeRNG(opts.seed ?? 8811);
  const density = BUDGET[opts.tier] ?? 1;
  const B = new PropBatcher(assets, scene, collision);

  /*
   * `groundHeight` returns the world's floor sentinel (-6) when the footprint
   * is over nothing at all, so "no ground here" is a value to compare against
   * rather than a null to check.
   */
  const VOID = -5.9;
  const surface = (x, z, from) => {
    const y = collision.groundHeight(x, z, from, 0.35);
    return y > VOID ? y : null;
  };

  /**
   * Ground height near an expected level, or null when the spot is unusable.
   *
   * `groundHeight` finds the top of whatever is there — including the roof of
   * a house. Rejecting anything more than a stride from the terrace the caller
   * expected is what stops bins appearing on rooftops and gas bottles being
   * buried inside staircases.
   */
  const ground = (x, z, expectY, tol = 1.2) =>
    { const y = surface(x, z, expectY + 4); return y != null && Math.abs(y - expectY) <= tol ? y : null; };

  /** Is there room here, and has nothing else claimed it? */
  const taken = [];
  const free = (x, z, r) => {
    for (const t of taken) {
      if ((x - t.x) ** 2 + (z - t.z) ** 2 < (r + t.r) ** 2) return false;
    }
    taken.push({ x, z, r });
    return true;
  };
  /** Claim ground unconditionally — for a footprint bigger than its test. */
  const claim = (x, z, r) => { taken.push({ x, z, r }); };

  /*
   * Nothing solid goes in the mouth of a climb.
   *
   * This is not tidiness. The navigation graph puts a waypoint at the foot of
   * every flight and, if that waypoint is inside something solid, relocates it
   * to the nearest clear spot — so one six-metre electricity pole dropped at
   * the bottom of the grand stair moved the waypoint sideways into the
   * bandstand railing and closed the main route up the hill. It showed up as a
   * single FAIL line in the map check and as nothing at all on screen.
   *
   * The map already recorded the rects it keeps clear for exactly this reason.
   */
  const climbRects = (meta.reserved ?? []).filter((r) => r.why === 'climb');
  const inClimb = (x, z) => climbRects.some((r) =>
    x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);

  /*
   * The slum kit goes down first, before any of the clutter.
   *
   * Order is not cosmetic here. Everything below claims ground through `free`,
   * and a thousand gas bottles and tyres scattered across the hillside leave no
   * two-and-a-half-metre square anywhere on it — run the other way round and
   * nine shacks in ten lose the roll to a barrel. Buildings first, then the
   * things people leave leaning against them, which is also the order the
   * hillside was built in.
   */
  const slums = dressSlums(B, assets, world, { rng, density, free, claim, ground, surface });

  /* ── ground clutter ────────────────────────────────────────────────
   * Weighted so the common things stay common. A hillside has far more gas
   * bottles and water drums than it has burnt-out oil drums.
   */
  const CLUTTER = [
    { id: 'propane_tank', w: 14, r: 0.34, solid: true },
    { id: 'small_lpg_tank', w: 9, r: 0.32, solid: true },
    { id: 'Barrel_02', w: 12, r: 0.3, solid: true },
    { id: 'Barrel_01', w: 8, r: 0.34, solid: true },
    { id: 'old_tyre', w: 11, r: 0.36, solid: false },
    { id: 'metal_trash_can', w: 8, r: 0.34, solid: true, part: 'metal_trash_can_rust' },
    { id: 'cardboard_box_01', w: 8, r: 0.3, solid: false },
    { id: 'barrel_stove', w: 4, r: 0.34, solid: true },
    { id: 'SchoolChair_01', w: 6, r: 0.34, solid: false },
    { id: 'wooden_ladder', w: 3, r: 0.4, solid: false },
  ];
  const totalW = CLUTTER.reduce((a, c) => a + c.w, 0);
  const pickClutter = () => {
    let r = rng() * totalW;
    for (const c of CLUTTER) if ((r -= c.w) <= 0) return c;
    return CLUTTER[0];
  };

  /*
   * Clutter hugs walls. Objects dropped in the open read as scattered debris
   * and get in the way of movement; objects tucked against a facade read as
   * belonging to the house and leave the lane clear, which matters because
   * these lanes are the map's fighting space.
   */
  const houses = meta.houses ?? [];
  // Attempts, not placements: most of these are rejected for landing on a
  // staircase, inside a neighbouring wall, or on top of something already
  // there, so the hit rate is roughly a third.
  const wallSpots = Math.round(houses.length * 9 * density);
  for (let i = 0; i < wallSpots; i++) {
    const h = houses[rng.int(0, houses.length - 1)];
    if (!h) break;
    const side = rng.int(0, 3);
    const along = rng.range(-0.44, 0.44);
    const out = rng.range(0.45, 0.75);
    const [dx, dz] = side === 0 ? [along * h.w, -h.d / 2 - out]
      : side === 1 ? [along * h.w, h.d / 2 + out]
        : side === 2 ? [-h.w / 2 - out, along * h.d]
          : [h.w / 2 + out, along * h.d];

    const x = h.x + dx, z = h.z + dz;
    const c = pickClutter();
    if ((c.solid && inClimb(x, z)) || !free(x, z, c.r)) continue;
    const y = ground(x, z, h.y);
    if (y == null) continue;

    if (B.stand(c.id, c.part, x, y, z, rng() * Math.PI * 2) && c.solid) {
      collision.addBox(x, y + 0.45, z, c.r * 2, 0.9, c.r * 2, 'prop');
    }
  }

  /* ── facades: air conditioners, shutters, meter boxes ───────────── */
  const acSize = B.measure('exterior_aircon_unit');
  for (const h of houses) {
    if (rng() > 0.34 * density) continue;
    const side = rng.int(0, 3);
    const yaw = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? -Math.PI / 2 : Math.PI / 2;
    // 0.05 m clear of the wall: the scan has depth of its own, and sinking it
    // into the box would z-fight along the mounting plate
    const off = 0.05;
    const [dx, dz] = side === 0 ? [rng.range(-0.3, 0.3) * h.w, -h.d / 2 - off]
      : side === 1 ? [rng.range(-0.3, 0.3) * h.w, h.d / 2 + off]
        : side === 2 ? [-h.w / 2 - off, rng.range(-0.3, 0.3) * h.d]
          : [h.w / 2 + off, rng.range(-0.3, 0.3) * h.d];
    const y = h.y + rng.range(2.2, Math.max(2.4, h.h - 0.8));
    B.stand('exterior_aircon_unit', rng.chance(0.5) ? 'exterior_aircon_unit_rusted' : 'exterior_aircon_unit',
      h.x + dx, y - (acSize ? acSize.min.y : 0), h.z + dz, yaw);
  }

  // roller shutters at street level, on the houses that face a lane
  for (const h of houses) {
    if (h.terraceIndex > 2 || rng() > 0.22 * density) continue;
    const front = rng.chance(0.5) ? -1 : 1;
    const id = rng.chance(0.5) ? 'rollershutter_door'
      : rng.chance(0.5) ? 'rollershutter_window_01' : 'rollershutter_window_03';
    const part = rng.chance(0.45) ? `${id}_graffiti` : id;
    B.stand(id, part, h.x + rng.range(-0.25, 0.25) * h.w, h.y + 0.02,
      h.z + front * (h.d / 2 + 0.08), front > 0 ? 0 : Math.PI);
  }

  /* ── power poles ────────────────────────────────────────────────────
   * The tangle of illegal hookups overhead is the single most recognisable
   * thing about a favela lane, and it is the one piece of set dressing that
   * changes the skyline rather than the floor.
   *
   * Poly Haven ships the pole kit as loose components plus three assembled
   * `preset_*` sets, but the presets are separate top-level nodes rather than
   * one group — so a "pole" here means every node sharing a preset prefix,
   * placed on the same transform.
   */
  const poleParts = [];
  const poleRoot = assets.props.get('modular_electricity_poles');
  if (poleRoot) {
    for (const child of poleRoot.children) {
      if (/^preset_01/.test(child.name)) poleParts.push(child.name);
    }
  }

  const LANE_X = [-46, -22, 4, 28, 52];
  if (poleParts.length) {
    for (const lx of LANE_X) {
      for (let z = 58; z > -66; z -= rng.range(15, 24)) {
        const x = lx + rng.range(-2.5, 2.5);
        if (inClimb(x, z) || !free(x, z, 1.4)) continue;
        const y = surface(x, z, 60);
        if (y == null) continue;
        const yaw = rng() * Math.PI * 2;
        for (const part of poleParts) B.stand('modular_electricity_poles', part, x, y, z, yaw);
        collision.addBox(x, y + 3, z, 0.4, 6, 0.4, 'prop');
      }
    }
  }

  /* ── the police roadblock at the foot of the hill ───────────────── */
  if (surface(0, 74, 30) != null) {
    for (let i = -3; i <= 3; i++) {
      const x = i * 2.0 + rng.range(-0.2, 0.2);
      const y = surface(x, 74, 30);
      if (y == null) continue;
      B.stand('concrete_road_barrier', null, x, y, 74, rng.range(-0.1, 0.1));
      collision.addBox(x, y + 0.42, 74, 1.6, 0.84, 0.7, 'prop');
    }
  }

  // one tarped car parked on the lower street
  const carY = surface(-28, 60, 30);
  if (carY != null) {
    B.stand('covered_car', null, -28, carY, 60, 0.3);
    collision.addBox(-28, carY + 0.65, 60, 2.2, 1.3, 4.6, 'prop');
  }

  /* ── rooftops ───────────────────────────────────────────────────────
   * The lajes are fighting positions, so what sits on them is gameplay as
   * well as dressing: tyres and boxes give a crouching player something to
   * break their silhouette against, and a ladder marks a roof as climbable
   * even though the climb itself is the map's own geometry.
   */
  for (const h of houses) {
    const n = rng.int(0, Math.round(3 * density));
    for (let i = 0; i < n; i++) {
      const x = h.x + rng.range(-0.34, 0.34) * h.w;
      const z = h.z + rng.range(-0.34, 0.34) * h.d;
      if (!free(x, z, 0.42)) continue;
      const y = ground(x, z, h.roof, 0.7);
      if (y == null) continue;
      const c = rng.chance(0.42) ? { id: 'old_tyre' }
        : rng.chance(0.5) ? { id: 'cardboard_box_01' }
          : rng.chance(0.5) ? { id: 'Barrel_02' } : { id: 'ladder_sectioned_01', part: 'ladder_section_01' };
      B.stand(c.id, c.part, x, y, z, rng() * Math.PI * 2);
    }
  }

  /* ── street furniture on the paved terraces ─────────────────────── */
  for (let i = 0; i < Math.round(14 * density); i++) {
    const x = rng.range(-60, 60), z = rng.range(20, 72);
    if (!free(x, z, 0.8)) continue;
    const y = surface(x, z, 30);
    if (y == null) continue;
    if (rng.chance(0.5)) {
      B.stand('water_manhole_cover', 'water_manhole_cover_frame', x, y + 0.01, z, rng() * Math.PI);
      B.stand('water_manhole_cover', 'water_manhole_cover', x, y + 0.02, z, rng() * Math.PI);
    } else {
      const id = rng.chance(0.5) ? 'utility_box_01' : 'utility_box_02';
      B.stand(id, null, x, y, z, rng.int(0, 3) * Math.PI / 2);
      collision.addBox(x, y + 0.56, z, 0.95, 1.12, 0.5, 'prop');
    }
  }

  /* ── vehicles ───────────────────────────────────────────────────────
   * The map records where a marked patrol car belongs; the model goes down
   * here because only this module has the asset library. Civilian traffic is
   * parked along the lower street from the same pack, which does more for the
   * "this is a real place" read than any amount of extra clutter: a street
   * with cars on it is inhabited.
   */
  /*
   * The marked patrol car is a supplied model rather than one from the kit, so
   * it is preferred wherever the map asked for a police vehicle and the kit car
   * stands in if it is absent. It is modelled in centimetres — the manifest
   * carries the scale rather than this code guessing it, because the next
   * supplied model will arrive in whatever unit its author happened to use.
   */
  const supplied = (pack, slot) => {
    const src = assets.models.get(`${pack}:${slot}`);
    const rec = assets.manifest?.models?.find((m) => m.pack === pack && m.slot === slot);
    return src ? { src, scale: rec?.scale ?? 1 } : null;
  };

  /*
   * The battalion rolls in an armoured truck rather than saloons. The
   * interceptor stays as the second choice and the kit car as the third, so the
   * map still populates if a supplied model is missing.
   */
  const heroCar = supplied('police', 'caveirao') ?? supplied('police', 'interceptor');

  const placeCar = (slot, x, y, z, yaw) => {
    const isPolice = slot === 'police';
    const pick = isPolice ? heroCar : null;
    const src = pick?.src ?? assets.models.get(`cars:${slot}`);
    if (!src) return false;
    const sc = pick?.scale ?? 1;
    _q.setFromAxisAngle(_up, yaw);
    B.placeObject(`car:${pick ? 'police-hero' : slot}`, src,
      _m.compose(_v.set(x, y, z), _q, _s.set(sc, sc, sc)));
    // a car is roughly 1.85 × 4.3 m; the rotated footprint is squared off for
    // the broadphase, and being generous keeps the AI from clipping through
    const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
    collision.addBox(x, y + 0.62, z, 1.85 * c + 4.3 * sn, 1.25, 1.85 * sn + 4.3 * c, 'vehicle');
    return true;
  };

  for (const v of meta.vehicles ?? []) {
    const y = surface(v.x, v.z, 30);
    if (y != null) placeCar(v.kind, v.x, y, v.z, v.rotY);
  }

  /*
   * Parked civilian traffic along the road at the foot of the hill.
   *
   * The height test is the load-bearing part. Sampling the surface is not
   * enough on its own — the map's perimeter wall runs along the same z, and
   * `groundHeight` happily reports its coping as ground, which parks a saloon
   * on top of a ten-metre wall. Requiring the spot to be at road level keeps
   * the cars on the road.
   */
  const CIVIL = ['sedan', 'sedan2', 'suv', 'taxi'];
  const ROAD_Y = 1.2;
  for (let i = 0; i < Math.round(16 * density); i++) {
    const x = rng.range(-52, 52), z = 62 + rng.range(-2.5, 2.5);
    if (!free(x, z, 3.4)) continue;
    const y = surface(x, z, 30);
    if (y == null || y > ROAD_Y) continue;
    placeCar(CIVIL[rng.int(0, CIVIL.length - 1)], x, y, z,
      (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.05, 0.05));
  }

  /* ── vegetation ─────────────────────────────────────────────────────
   * Palms, not conifers. The hillside is in Rio, and the green cones these
   * replace were the most toy-like thing left in frame — a cone reads as a
   * placeholder at any distance, where a palm with real fronds reads as a
   * place even at fifty metres.
   *
   * Planted on the slopes and terrace edges rather than the lanes: vegetation
   * in the middle of a fighting space is cover the AI cannot reason about, and
   * on the fringes it does its job of softening the boxes anyway.
   */
  const PALMS = ['palm1', 'palm2', 'palm3'];
  const SCRUB = ['plant1', 'plant2', 'plant3', 'bush1', 'bush2'];
  const plant = (slot, x, y, z, yaw, scale) => {
    const src = assets.models.get(`nature:${slot}`);
    if (!src) return false;
    _q.setFromAxisAngle(_up, yaw);
    B.placeObject(`veg:${slot}`, src, _m.compose(_v.set(x, y, z), _q, _s.set(scale, scale, scale)));
    return true;
  };

  for (let i = 0; i < Math.round(70 * density); i++) {
    const edge = rng.chance(0.55);
    // either hard against the perimeter, or tucked along a terrace lip
    const x = edge ? (rng.chance(0.5) ? -1 : 1) * rng.range(58, 74) : rng.range(-70, 70);
    const z = edge ? rng.range(-74, 74) : (rng.chance(0.5) ? -1 : 1) * rng.range(56, 74);
    if (!free(x, z, 1.6)) continue;
    const y = surface(x, z, 40);
    if (y == null) continue;
    const palm = rng.chance(0.42);
    plant(palm ? PALMS[rng.int(0, 2)] : SCRUB[rng.int(0, SCRUB.length - 1)],
      x, y, z, rng() * Math.PI * 2, palm ? rng.range(0.9, 1.5) : rng.range(0.7, 1.3));
  }

  // the terrace-lip spots the map picked out
  for (const f of meta.foliage ?? []) {
    if (!free(f.x, f.z, 1.2)) continue;
    const y = ground(f.x, f.z, f.y, 2.2);
    if (y == null) continue;
    const palm = f.seed < 0.38;
    plant(palm ? PALMS[(f.seed * 97 | 0) % 3] : SCRUB[(f.seed * 131 | 0) % SCRUB.length],
      f.x, y, f.z, f.seed * 44, palm ? 0.85 + f.seed : 0.6 + f.seed * 0.8);
  }

  // a few palms inside the map, on terrace corners where they will not block a lane
  for (const t of houses) {
    if (rng() > 0.16 * density) continue;
    const x = t.x + (rng.chance(0.5) ? -1 : 1) * (t.w / 2 + rng.range(1.4, 2.6));
    const z = t.z + (rng.chance(0.5) ? -1 : 1) * (t.d / 2 + rng.range(1.4, 2.6));
    if (!free(x, z, 1.5)) continue;
    const y = ground(x, z, t.y, 1.0);
    if (y == null) continue;
    plant(rng.chance(0.6) ? PALMS[rng.int(0, 2)] : 'tree1', x, y, z,
      rng() * Math.PI * 2, rng.range(0.85, 1.25));
  }

  /* ── the city kit ───────────────────────────────────────────────────
   * Modular architecture on a 2 × 3 m grid, used where the map has already
   * built the structure and only the fittings are missing. The map knows where
   * it punched every doorway and laid every flight of steps, and recorded
   * them; this hangs the real thing in them.
   *
   * Everything here is decorative. The doorways and staircases are already
   * solid, or already deliberately walkable, and adding collision to a handrail
   * is how a route the AI depends on quietly stops working — the map check
   * exists because that has happened before.
   */
  const kit = (slot) => assets.model('city', slot);

  /* real doors in the openings the houses punched */
  const LEAVES = ['door_wood', 'door_panel', 'door_metal'];
  const leaves = LEAVES.map(kit).filter(Boolean);
  if (leaves.length) {
    for (const d of meta.doors ?? []) {
      const pick = (Math.abs(d.x * 31 + d.z * 17) | 0) % leaves.length;
      // the module is a 1.00 × 2.20 m leaf; the opening is 0.95 × 2.05
      _q.setFromAxisAngle(_up, Math.atan2(d.nx, d.nz));
      B.placeObject(`city:${LEAVES[pick]}`, leaves[pick],
        _m.compose(_v.set(d.x, d.y, d.z), _q, _s.set(d.w / 1.0, d.h / 2.2, 1)));
    }
  }

  /*
   * Handrails down the staircases — the map is built around its stairs and
   * they were the last thing on it with no ironwork at all.
   *
   * The module is a fixed-pitch flight: 1.98 m of rise over 2.31 m of run,
   * about 41°. These stairs climb 0.29 over a 0.46 tread, about 32°, so the
   * module is scaled to the run and to the rise separately. That lands the
   * handrail on exactly the right slope, at the cost of standing the posts
   * about three-quarters height — which is the price of a fixed-pitch kit and
   * is invisible next to a rail that floats or cuts through the treads.
   *
   * `rail_run` is the obvious-looking choice and the wrong one: it is the bar
   * alone, with no posts under it, so it hangs in the air.
   */
  const rail = kit('rail_flight');
  if (rail) {
    const RUN = 2.31, RISE = 1.98;
    for (const s of meta.stairs ?? []) {
      const perSeg = Math.max(2, Math.round(RUN / s.tread));
      // the grand stair is wide enough for a pair either side of its divider
      const lanes = s.grand ? [-s.width / 4, s.width / 4] : [0];
      for (let i = 0; i + perSeg <= s.steps; i += perSeg) {
        const run = s.tread * perSeg;
        const rise = s.riser * perSeg;
        const z = s.zTop + s.tread * (s.steps - i) - run;
        const y = s.yLow + s.riser * i;
        for (const lane of lanes) {
          _q.setFromAxisAngle(_up, 0);
          B.placeObject('city:rail', rail,
            _m.compose(_v.set(s.x + lane, y, z), _q, _s.set(1, rise / RISE, run / RUN)));
        }
      }
    }
  }

  /* street furniture along the paved lower ground */
  const FURNITURE = [
    { slot: 'bollard', w: 7, r: 0.4 },
    { slot: 'drain', w: 5, r: 0.5 },
    { slot: 'manhole', w: 4, r: 0.6 },
    { slot: 'planter', w: 3, r: 1.2 },
    { slot: 'kerb_planter', w: 3, r: 1.1 },
  ];
  const furniture = FURNITURE.filter((f) => assets.model('city', f.slot));
  if (furniture.length) {
    const total = furniture.reduce((a, f) => a + f.w, 0);
    for (let i = 0; i < Math.round(46 * density); i++) {
      const x = rng.range(-64, 64);
      const z = rng.range(24, 74);            // the flat ground at the foot
      let roll = rng() * total;
      const pickF = furniture.find((f) => (roll -= f.w) <= 0) ?? furniture[0];
      if (!free(x, z, pickF.r)) continue;
      const y = surface(x, z, 8);
      if (y == null || y > ROAD_Y + 1.5) continue;
      _q.setFromAxisAngle(_up, rng.chance(0.5) ? 0 : Math.PI / 2);
      B.placeObject(`city:${pickF.slot}`, assets.model('city', pickF.slot),
        _m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)));
    }
  }

  /*
   * The summit statue, standing where the boxed cross used to. The map has
   * already left a hidden collision column for it, so this only has to put the
   * geometry in the right place — and "the right place" is measured, not
   * assumed, because a supplied model arrives in the author's units with the
   * author's origin.
   *
   *   · scaled to the height the map reserved, from its own bounding box
   *   · centred on the plinth by its box, not by its origin, which sits a metre
   *     off to one side
   *   · sat on the plinth by its base
   *   · facing +z, down the hill and over the city, which is where the real one
   *     looks and also the direction the police come from
   *
   * It ships with no materials at all — 39 metres of untextured mesh — so it
   * gets soapstone here: pale, rough, barely metallic, and taking its light
   * from the sky like everything else on the hill.
   */
  const statue = supplied('landmark', 'christ');
  if (statue && meta.monument) {
    const m0 = meta.monument;
    statue.src.updateMatrixWorld(true);
    _box.setFromObject(statue.src);
    _box.getSize(_size);
    const sc = MONUMENT_H / (_size.y || 1);
    const stone = new THREE.MeshStandardMaterial({
      color: 0xa9a79e, roughness: 0.95, metalness: 0, envMapIntensity: 0.5,
    });
    statue.src.traverse((o) => { if (o.isMesh) o.material = stone; });
    _q.setFromAxisAngle(_up, 0);
    B.placeObject('landmark:christ', statue.src, _m.compose(
      _v.set(m0.x - (_box.min.x + _size.x / 2) * sc,
        m0.y - _box.min.y * sc,
        m0.z - (_box.min.z + _size.z / 2) * sc),
      _q, _s.set(sc, sc, sc)));
  }

  const built = B.build();
  return { ...built, group: built.root, slums };
}
