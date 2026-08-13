import * as THREE from 'three';
import { PartMesh } from '../entities/character.js';

/**
 * Weapon stats + procedural weapon models.
 * Damage is per-bullet before the headshot multiplier and range falloff.
 */
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: '.38 SPECIAL', slot: 1, short: 'PST',
    damage: 26, rpm: 300, auto: false, mag: 6, reserve: 42, maxReserve: 60,
    reload: 1.9, pellets: 1,
    spreadHip: 0.024, spreadAim: 0.0050, spreadMove: 0.022, bloom: 0.009, bloomMax: 0.055,
    recoil: 1.5, recoilSide: 0.5, range: 55, falloff: 0.45,
    moveMul: 1.0, aimMul: 0.62, sndSize: 1.0, headMul: 2.2,
  },
  smg: {
    id: 'smg', name: 'SUB 9MM', slot: 2, short: 'SMG',
    damage: 15, rpm: 820, auto: true, mag: 30, reserve: 120, maxReserve: 210,
    reload: 2.1, pellets: 1,
    spreadHip: 0.032, spreadAim: 0.0110, spreadMove: 0.026, bloom: 0.0032, bloomMax: 0.035,
    recoil: 0.65, recoilSide: 0.42, range: 42, falloff: 0.5,
    moveMul: 0.97, aimMul: 0.58, sndSize: 0.85, headMul: 1.8,
  },
  rifle: {
    id: 'rifle', name: 'RIFLE 5.56', slot: 3, short: 'RIF',
    damage: 27, rpm: 620, auto: true, mag: 30, reserve: 120, maxReserve: 210,
    reload: 2.6, pellets: 1,
    spreadHip: 0.030, spreadAim: 0.0045, spreadMove: 0.026, bloom: 0.0034, bloomMax: 0.032,
    recoil: 1.05, recoilSide: 0.4, range: 95, falloff: 0.72,
    moveMul: 0.92, aimMul: 0.52, sndSize: 1.15, headMul: 2.0,
  },
  shotgun: {
    id: 'shotgun', name: 'PUMP 12G', slot: 4, short: 'SHG',
    damage: 13, rpm: 75, auto: false, mag: 6, reserve: 30, maxReserve: 48,
    reload: 0.55, shellReload: true, pellets: 9,
    spreadHip: 0.070, spreadAim: 0.045, spreadMove: 0.020, bloom: 0.003, bloomMax: 0.016,
    recoil: 3.6, recoilSide: 1.1, range: 24, falloff: 0.16,
    moveMul: 0.9, aimMul: 0.6, sndSize: 1.45, headMul: 1.4,
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'shotgun'];

/* ── models ──────────────────────────────────────────────────────────
 *
 * Every gun is built from 2D side-view profiles extruded across the weapon's
 * width, plus turned parts for anything cylindrical.
 *
 * A firearm read in silhouette *is* its side view — the banana curve of an AK
 * magazine, the step where a pistol slide meets the frame, the drop of a
 * shotgun stock. Extruding that profile gets those shapes exactly right, and
 * it costs no more than the axis-aligned boxes it replaces. The bevel on every
 * extrusion is the other half of it: a hard 90° edge catches no light at all,
 * so a bevelled edge two millimetres wide is what makes a receiver read as
 * machined metal rather than as a grey block.
 *
 * Parts are sorted into two buffers, metal and non-metal, because a wooden
 * stock shaded as metal looks like painted tin and a polymer grip shaded as
 * metal looks like chrome. Two merged meshes per weapon is the cheapest way to
 * get that right without patching the standard material's shader.
 */

const G = new Map();
const cache = (k, make) => {
  let g = G.get(k);
  if (!g) G.set(k, (g = make()));
  return g;
};

const _wm = new THREE.Matrix4();
const _wq = new THREE.Quaternion();
const _wv = new THREE.Vector3();
const _ws = new THREE.Vector3(1, 1, 1);
const _we = new THREE.Euler();

/**
 * Extrude a side-view profile across the gun's width.
 *
 * `pts` are [z, y] pairs in metres, with -Z down the barrel, traced in order
 * around the outline. The result is centred on X and carries the bevel that
 * gives the edges a highlight.
 */
function profile(key, pts, width, bevel = 0.0035) {
  return cache(`p${key}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(width - bevel * 2, 0.001),
      bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
      curveSegments: 6,
    });
    /*
     * The shape's local x carries the intended world z and the extrusion runs
     * along local z, which has to become world x. Rotating +90° about Y does
     * swap those axes — but it also negates z, which silently mirrors every
     * profile front-to-back: handguards end up behind the shooter and stocks
     * out past the muzzle. -90° is the rotation that preserves the sign.
     */
    g.rotateY(-Math.PI / 2);
    g.translate(width / 2 - bevel, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * The banana magazine.
 *
 * `depth` is the front-to-back measurement — the one you see in profile — and
 * `width` is the thin cross-axis. Getting those the wrong way round is easy
 * and produces a magazine that looks like a blade edge-on to the shooter.
 *
 * The spine sweeps forward as it drops, which is the entire reason a 7.62
 * rifle is recognisable from fifty metres away.
 */
function curvedMag(key, len, depthTop, depthBot, arc, width) {
  return cache(`c${key}`, () => {
    const front = [], back = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = -len * t;
      // t² rather than sin(t): a sine spreads the bend evenly down the
      // magazine and reads as a straight slab tipped forward, where the real
      // curve is gentle at the well and tightens toward the floorplate
      const z = -(arc * t * t) * len;                  // forward as it drops
      const half = (depthTop + (depthBot - depthTop) * t) / 2;
      front.push([z - half, y]);
      back.push([z + half, y]);
    }
    return profile(key, [...front, ...back.reverse()], width);
  });
}

/** Barrel / tube running down -Z. */
const rod = (r, len, seg = 10) => cache(`r${r}|${len}|${seg}`, () => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
});

/** A short turned ring — muzzle brakes, gas blocks, suppressor collars. */
const ring = (r, len, seg = 10) => rod(r, len, seg);

const box = (w, h, d) => cache(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));

const GUNMETAL = 0x383c43;   // parkerised steel, lifted so the form reads small
const STEEL = 0x878e97;      // bare/worn steel: bolt, barrel, sights
const POLYMER = 0x26292e;    // moulded furniture
const WOOD = 0x7a4e28;       // AK / shotgun furniture
const BRASS = 0xb08d4a;

/**
 * Two materials, one metallic and one not.
 *
 * Both take the scanned normal and roughness the asset pack provides for
 * metal, so a receiver has fine machining grain rather than a mirror finish —
 * a perfectly smooth gun at this size reads as plastic no matter how dark it
 * is.
 */
export const WEAPON_METAL = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.34, metalness: 1.0, envMapIntensity: 1.15,
});
export const WEAPON_POLY = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.58, metalness: 0.0, envMapIntensity: 0.75,
});

/** Apply the scanned surface detail once the asset pack has loaded. */
export function applyWeaponMaterials(assets) {
  if (!assets?.ready) return false;
  const wrap = (t, r) => {
    if (!t) return null;
    const c = t.clone();
    c.needsUpdate = true;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(r, r);
    return c;
  };
  const rust = assets.material('rust');
  const leather = assets.material('leather');
  if (rust?.normal) {
    WEAPON_METAL.normalMap = wrap(rust.normal, 3);
    WEAPON_METAL.normalScale = new THREE.Vector2(0.28, 0.28);
    WEAPON_METAL.needsUpdate = true;
  }
  if (leather?.normal) {
    WEAPON_POLY.normalMap = wrap(leather.normal, 8);
    WEAPON_POLY.normalScale = new THREE.Vector2(0.45, 0.45);
    WEAPON_POLY.needsUpdate = true;
  }
  return true;
}

/**
 * Builds a weapon oriented so that -Z is "down the barrel", ready to be
 * parented to a hand. The `muzzle` child marks where fire comes from.
 */
const MODEL_CACHE = new Map();

/** Assemble one weapon's part list into merged metal / non-metal buffers. */
function buildGeometry(id) {
  const metal = new PartMesh();
  const poly = new PartMesh();

  // `m` = metal buffer, `p` = non-metal buffer. Both take an optional yaw/roll
  // so angled parts (grips, magazines, stocks) sit where they should.
  const put = (buf) => (geo, colour, x, y, z, rx = 0, ry = 0, rz = 0) => {
    _we.set(rx, ry, rz);
    buf.add(geo, _wm.compose(_wv.set(x, y, z), _wq.setFromEuler(_we), _ws.set(1, 1, 1)), colour);
  };
  const m = put(metal);
  const p = put(poly);

  let muzzleZ = -0.3, muzzleY = 0.04;

  switch (id) {
    /* ── compact 9 mm pistol ────────────────────────────────────────
     * The read is the step between slide and frame, the squared trigger
     * guard, and the grip raked back about 18°.
     */
    case 'pistol': {
      const W = 0.032;
      // slide: flat top, dust cover stepping down at the front
      m(profile('pist-slide', [
        [-0.155, 0.028], [-0.155, 0.072], [-0.128, 0.078], [0.055, 0.078],
        [0.062, 0.070], [0.062, 0.030], [-0.02, 0.026], [-0.09, 0.026],
      ], W), GUNMETAL, 0, 0, 0);
      // ejection port
      m(box(W + 0.002, 0.016, 0.05), 0x101215, 0.0, 0.062, -0.03);
      // frame with the trigger-guard loop drawn into the outline
      p(profile('pist-frame', [
        [-0.10, 0.026], [0.062, 0.026], [0.062, -0.01], [0.030, -0.012],
        [0.026, -0.048], [-0.004, -0.052], [-0.010, -0.016], [-0.052, -0.014],
        [-0.10, -0.006],
      ], W - 0.004), POLYMER, 0, 0, 0);
      // grip, raked back
      p(profile('pist-grip', [
        [-0.019, 0.0], [0.023, 0.0], [0.030, -0.125], [-0.014, -0.125],
      ], W + 0.001), POLYMER, 0, -0.012, 0.036, 0, 0, -0.05);
      p(box(W + 0.004, 0.008, 0.042), 0x0d0f11, 0, -0.138, 0.043);   // magazine floorplate
      m(rod(0.0075, 0.045, 8), STEEL, 0, 0.049, -0.168);             // barrel at the crown
      m(box(0.006, 0.011, 0.005), STEEL, 0, 0.086, -0.14);           // front sight
      m(box(0.020, 0.011, 0.006), STEEL, 0, 0.086, 0.05);            // rear sight
      m(box(0.004, 0.026, 0.004), STEEL, 0, -0.03, -0.006);          // trigger
      muzzleZ = -0.19; muzzleY = 0.049;
      break;
    }

    /* ── 9 mm submachine gun ────────────────────────────────────────
     * Tube receiver, cocking-handle tube riding on top, a straight stick
     * magazine through the grip, and a skeleton stock.
     */
    case 'smg': {
      const W = 0.042;
      m(rod(0.026, 0.30, 12), GUNMETAL, 0, 0.03, -0.06);             // receiver tube
      m(rod(0.013, 0.30, 8), GUNMETAL, -0.024, 0.052, -0.06);        // cocking tube
      m(rod(0.0105, 0.13, 8), STEEL, 0, 0.03, -0.26);                // barrel
      m(ring(0.017, 0.03, 10), GUNMETAL, 0, 0.03, -0.20);            // barrel nut
      // handguard
      p(profile('smg-hg', [
        [-0.235, 0.004], [-0.11, 0.004], [-0.105, -0.03], [-0.232, -0.032],
      ], W), POLYMER, 0, 0.03, 0);
      // trigger group + pistol grip
      p(profile('smg-grip', [
        [-0.055, 0.006], [0.055, 0.006], [0.055, -0.03], [0.016, -0.034],
        [0.010, -0.056], [-0.028, -0.058], [-0.034, -0.03], [-0.055, -0.028],
      ], W - 0.002), POLYMER, 0, 0.012, 0.02);
      p(profile('smg-pgrip', [
        [-0.021, 0.0], [0.024, 0.0], [0.030, -0.115], [-0.010, -0.115],
      ], W - 0.004), POLYMER, 0, -0.02, 0.052, 0, 0, -0.12);
      m(box(0.026, 0.175, 0.040), GUNMETAL, 0, -0.10, 0.006, 0.10);  // magazine
      m(box(0.030, 0.010, 0.046), 0x0d0f11, 0, -0.186, 0.024);       // baseplate
      // folding stock: two rails and a butt plate
      m(box(0.006, 0.006, 0.20), STEEL, -0.026, 0.032, 0.20);
      m(box(0.006, 0.006, 0.20), STEEL, 0.026, 0.032, 0.20);
      m(box(0.062, 0.052, 0.012), 0x1a1c20, 0, 0.026, 0.30);
      m(box(0.030, 0.012, 0.008), STEEL, 0, 0.062, 0.06);            // rear aperture
      m(box(0.008, 0.016, 0.006), STEEL, 0, 0.062, -0.215);          // front post
      m(box(0.004, 0.024, 0.004), STEEL, 0, -0.008, 0.014);          // trigger
      muzzleZ = -0.33; muzzleY = 0.03;
      break;
    }

    /* ── 7.62 assault rifle ─────────────────────────────────────────
     * Everything that makes this silhouette recognisable is off the boxy
     * axis: the curved magazine, the gas tube stacked above the barrel, the
     * slanted muzzle brake and the stock dropping away behind the receiver.
     */
    case 'rifle': {
      const W = 0.038;
      /*
       * Coordinates are laid out along one continuous line rather than picked
       * per part: muzzle at -0.49, barrel back to -0.16, receiver -0.17..0.06,
       * stock from 0.06 back. Every part below is written against that line,
       * which is what stops handguards floating a centimetre off the barrel.
       */
      // receiver: shallow, flat-topped, with the magazine well cut forward
      m(profile('rif-recv', [
        [-0.175, 0.058], [0.062, 0.058], [0.062, -0.018], [-0.02, -0.026],
        [-0.10, -0.026], [-0.175, -0.010],
      ], W), GUNMETAL, 0, 0, 0);
      m(profile('rif-dust', [
        [-0.15, 0.058], [0.055, 0.058], [0.050, 0.080], [-0.145, 0.080],
      ], W - 0.003), GUNMETAL, 0, 0, 0);

      m(rod(0.0115, 0.305, 8), STEEL, 0, 0.038, -0.310);        // barrel
      m(rod(0.0125, 0.140, 8), GUNMETAL, 0, 0.072, -0.245);     // gas tube, stacked above
      m(box(0.024, 0.070, 0.030), GUNMETAL, 0, 0.045, -0.300);  // gas block ties the two
      m(box(0.022, 0.050, 0.026), GUNMETAL, 0, 0.045, -0.170);  // rear gas-tube collar

      // wooden furniture, sitting hard against the barrel line
      p(profile('rif-hgl', [
        [-0.300, 0.020], [-0.170, 0.020], [-0.166, -0.030], [-0.296, -0.024],
      ], W + 0.004), WOOD, 0, 0.026, 0);
      p(profile('rif-hgu', [
        [-0.292, 0.058], [-0.196, 0.058], [-0.199, 0.092], [-0.288, 0.090],
      ], 0.030), WOOD, 0, 0.026, 0);

      // the banana, hung from the magazine well just forward of the trigger
      m(curvedMag('rif-mag', 0.215, 0.090, 0.074, 0.62, 0.026),
        GUNMETAL, 0, -0.022, -0.058);

      // pistol grip, immediately behind the trigger guard
      p(profile('rif-grip', [
        [-0.024, 0.0], [0.028, 0.0], [0.036, -0.112], [-0.004, -0.112],
      ], W - 0.004), POLYMER, 0, -0.020, 0.036, 0, 0, -0.22);
      m(profile('rif-tguard', [
        [-0.070, -0.018], [0.012, -0.018], [0.012, -0.042], [-0.066, -0.044],
      ], W - 0.006), GUNMETAL, 0, 0, 0);
      m(box(0.004, 0.024, 0.004), STEEL, 0, -0.032, -0.030);    // trigger

      // stock: rises off the receiver's rear face and drops to the butt
      p(profile('rif-stock', [
        [0.062, 0.050], [0.140, 0.048], [0.288, 0.056], [0.288, 0.000],
        [0.196, -0.008], [0.126, -0.036], [0.062, -0.022],
      ], W - 0.008), WOOD, 0, 0, 0);
      p(box(W - 0.004, 0.058, 0.012), 0x121316, 0, 0.028, 0.292);

      // slanted brake and sights
      m(profile('rif-brake', [
        [-0.470, 0.018], [-0.428, 0.024], [-0.428, -0.020], [-0.470, -0.014],
      ], 0.028), GUNMETAL, 0, 0.038, 0);
      m(box(0.020, 0.016, 0.030), STEEL, 0, 0.082, -0.150);     // rear leaf
      m(box(0.014, 0.030, 0.014), GUNMETAL, 0, 0.070, -0.404);  // front sight base
      m(box(0.006, 0.014, 0.005), STEEL, 0, 0.090, -0.404);     // front post
      muzzleZ = -0.49; muzzleY = 0.038;
      break;
    }

    /* ── 12-gauge pump ──────────────────────────────────────────────
     * Barrel over tube magazine, ribbed forend, and a stock with real drop
     * at the comb — the drop is what stops it reading as a plank.
     */
    case 'shotgun': {
      const W = 0.042;
      m(profile('sg-recv', [
        [-0.085, 0.048], [0.085, 0.048], [0.085, -0.020], [0.02, -0.030],
        [-0.055, -0.030], [-0.085, -0.018],
      ], W), GUNMETAL, 0, 0.012, 0.02);
      m(rod(0.0165, 0.44, 10), STEEL, 0, 0.042, -0.29);              // barrel
      m(rod(0.0135, 0.34, 8), GUNMETAL, 0, 0.006, -0.25);            // tube magazine
      m(box(0.010, 0.016, 0.012), STEEL, 0, 0.024, -0.10);           // barrel/tube bridge
      m(box(0.010, 0.008, 0.006), BRASS, 0, 0.060, -0.49);           // bead
      // ribbed forend
      p(profile('sg-pump', [
        [-0.32, 0.024], [-0.19, 0.024], [-0.185, -0.030], [-0.315, -0.028],
      ], W + 0.004), WOOD, 0, 0.008, 0);
      for (let i = 0; i < 5; i++) {
        p(box(W + 0.007, 0.004, 0.008), 0x53331c, 0, 0.0, -0.30 + i * 0.026);
      }
      // stock: wrist, comb and butt in one profile
      p(profile('sg-stock', [
        [0.0, 0.046], [0.09, 0.042], [0.235, 0.060], [0.245, -0.030],
        [0.135, -0.040], [0.055, -0.058], [0.0, -0.028],
      ], W - 0.002), WOOD, 0, 0.012, 0.10);
      p(box(W + 0.002, 0.092, 0.012), 0x121316, 0, 0.026, 0.352);    // recoil pad
      p(profile('sg-grip', [
        [-0.028, 0.0], [0.03, 0.0], [0.03, -0.045], [-0.028, -0.052],
      ], W - 0.004), WOOD, 0, -0.02, 0.075);
      m(box(0.004, 0.026, 0.004), STEEL, 0, -0.012, 0.028);          // trigger
      m(box(0.030, 0.006, 0.055), GUNMETAL, 0, -0.026, 0.03);        // trigger plate
      muzzleZ = -0.52; muzzleY = 0.042;
      break;
    }
  }

  return {
    metal: metal.empty ? null : metal.build(),
    poly: poly.empty ? null : poly.build(),
    muzzle: new THREE.Vector3(0, muzzleY, muzzleZ),
  };
}

/*
 * ── real weapon models ──
 * When the CC0 pack is present the procedural guns are replaced outright by
 * hand-modelled ones. They are authored lying along +X at roughly four times
 * life size, so each needs a turn onto -Z (down the barrel) and a scale down
 * to a believable length. `len` is the real-world length in metres the model
 * is scaled to; `grip` shifts the model so the hand lands on the grip rather
 * than on the model's arbitrary origin.
 */
const PACKED = {
  pistol:  { len: 0.21, grip: [-0.055, 0.020, 0.020] },
  smg:     { len: 0.52, grip: [-0.140, 0.028, 0.020] },
  rifle:   { len: 0.90, grip: [-0.250, 0.030, 0.020] },
  shotgun: { len: 1.05, grip: [-0.300, 0.028, 0.020] },
};

let PACK = null;
/** Hand the weapon system the loaded model pack. Safe to call with null. */
export function setWeaponModels(assets) {
  PACK = assets?.ready && assets.models.size ? assets : null;
  MODEL_CACHE.clear();
  return !!PACK;
}

function packedModel(id) {
  const spec = PACKED[id];
  const src = spec && PACK?.model('guns', id);
  if (!src) return null;

  const g = new THREE.Group();
  const inner = new THREE.Group();
  // +X → -Z puts the barrel down the shooting axis
  inner.rotation.y = Math.PI / 2;
  inner.add(src);
  g.add(inner);

  // scale from the model's own length, so a pack update cannot silently
  // produce a rifle the size of a car
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const k = spec.len / Math.max(size.x, 1e-6);
  inner.scale.setScalar(k);

  // recentre on the grip, then find where the barrel actually ends
  inner.position.set(
    spec.grip[0] - box.min.x * k, spec.grip[1] - box.min.y * k, spec.grip[2]);
  g.updateMatrixWorld(true);
  const world = new THREE.Box3().setFromObject(g);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, (world.min.y + world.max.y) / 2, world.min.z);
  muzzle.name = 'muzzle';
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function buildWeaponModel(id) {
  const packed = packedModel(id);
  if (packed) return packed;

  let entry = MODEL_CACHE.get(id);
  if (!entry) MODEL_CACHE.set(id, (entry = buildGeometry(id)));

  const g = new THREE.Group();
  if (entry.metal) {
    const mesh = new THREE.Mesh(entry.metal, WEAPON_METAL);
    mesh.castShadow = true;
    g.add(mesh);
  }
  if (entry.poly) {
    const mesh = new THREE.Mesh(entry.poly, WEAPON_POLY);
    mesh.castShadow = true;
    g.add(mesh);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.copy(entry.muzzle);
  muzzle.name = 'muzzle';
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

/**
 * Attach a weapon to a character's right hand with a pose that puts the grip
 * in the fist and the barrel pointing forward.
 */
export function attachWeapon(character, id) {
  if (character.weaponModel) {
    character.rightHand.remove(character.weaponModel);
  }
  const m = buildWeaponModel(id);
  /*
   * The rigged actor hands over a mount that is already oriented — it works its
   * grip out from the animation library's own aim pose — so it supplies an
   * identity pose. The capsule rig's hand is a bare pivot and needs the barrel
   * turned up to horizontal by hand.
   */
  const pose = character.weaponPose;
  if (pose) {
    m.position.copy(pose.position);
    m.rotation.copy(pose.rotation);
  } else {
    m.position.set(0.012, -0.055, -0.035);
    m.rotation.set(Math.PI / 2, 0, 0);
  }
  character.rightHand.add(m);
  character.weaponModel = m;
  character.muzzleNode = m.userData.muzzle;
  return m;
}

/** Live ammo/heat state for one weapon in an inventory. */
export class WeaponState {
  constructor(id, { mag, reserve } = {}) {
    const def = WEAPONS[id];
    this.def = def;
    this.id = id;
    this.mag = mag ?? def.mag;
    this.reserve = reserve ?? def.reserve;
    this.reloading = false;
    this.reloadEnd = 0;
    this.reloadStart = 0;
    this.nextShot = 0;
    this.bloom = 0;
    this.owned = true;
    this.shotIndex = 0;
  }

  /**
   * Where the nth round of a magazine kicks the sights.
   *
   * Recoil was `Math.random()` per shot, which cannot be learned and therefore
   * cannot be countered — the only counter to noise is to stop firing. A
   * pattern is the opposite: the same every magazine, so a player who has spent
   * time with a weapon can pull down through it and one who has not cannot.
   * That difference is most of what makes an automatic weapon satisfying rather
   * than a damage tap.
   *
   * The shape is the familiar one: nearly vertical for the first few rounds
   * while the climb builds, then a horizontal drift that reverses, so the burst
   * traces a lazy S. The trig is doing the work of an authored curve — it is
   * deterministic, cheap, and different per weapon because the constants come
   * from the weapon's own recoil figures.
   *
   * @returns {{up:number, side:number}} in the weapon's own recoil units
   */
  pattern(n = this.shotIndex) {
    const d = this.def;
    // climb ramps in over the first four rounds, then holds
    const up = 0.55 + 0.45 * Math.min(1, n / 4);
    /*
     * The drift. Two waves at incommensurate rates so the pattern does not
     * simply repeat every few rounds, scaled by how far into the magazine we
     * are — the first couple of shots stay honest, which is what keeps tapping
     * accurate and rewards burst discipline.
     */
    const ramp = Math.min(1, n / 6);
    const side = ramp * (Math.sin(n * 0.9) * 0.7 + Math.sin(n * 0.37 + 1.1) * 0.5);
    return { up: up * d.recoil, side: side * d.recoilSide };
  }

  get full() { return this.mag >= this.def.mag; }
  get empty() { return this.mag <= 0; }
  get canReload() { return !this.reloading && this.reserve > 0 && !this.full; }

  /** Current cone half-angle in radians. */
  spread(aiming, moveSpeed, crouching) {
    const d = this.def;
    let s = aiming ? d.spreadAim : d.spreadHip;
    s += Math.min(moveSpeed / 6, 1) * d.spreadMove * (aiming ? 0.55 : 1);
    // sights soak up most of the sustained-fire bloom
    s += this.bloom * (aiming ? 0.45 : 1);
    if (crouching) s *= 0.75;
    return s;
  }

  addBloom() {
    this.bloom = Math.min(this.def.bloomMax, this.bloom + this.def.bloom);
  }

  /**
   * Back to the top of the recoil pattern.
   *
   * Called when the trigger has been off long enough to count as a new burst,
   * and on reload. Without it the pattern would be a property of the magazine
   * rather than of the burst, and tapping single shots would walk up the same
   * curve as holding the trigger down.
   */
  resetPattern() { this.shotIndex = 0; }

  decayBloom(dt) {
    this.bloom = Math.max(0, this.bloom - dt * (this.def.bloomMax * 1.6 + 0.02));
  }

  addAmmo(n) {
    const before = this.reserve;
    this.reserve = Math.min(this.def.maxReserve, this.reserve + n);
    return this.reserve - before;
  }
}
