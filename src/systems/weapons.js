import * as THREE from 'three';
import { PartMesh, GEAR_MATERIAL } from '../entities/character.js';

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

/* ── models ─────────────────────────────────────────────────────── */
const G = new Map();
const box = (w, h, d) => {
  const k = `${w}|${h}|${d}`;
  let g = G.get(k);
  if (!g) G.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
};

const _wm = new THREE.Matrix4();

/** Barrel / tube running down -Z. */
const rod = (r, len) => {
  const k = `r${r}|${len}`;
  let g = G.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, len, 8);
    g.rotateX(Math.PI / 2);            // stand it up along Z
    G.set(k, g);
  }
  return g;
};

const GUNMETAL = 0x2b2e33;
const POLYMER = 0x1b1d20;
const WOOD = 0x6b4a2f;
const STEEL = 0x585d66;

/**
 * Builds a weapon oriented so that -Z is "down the barrel", ready to be
 * parented to a hand. The `muzzle` child marks where fire comes from.
 */
const MODEL_CACHE = new Map();

export function buildWeaponModel(id) {
  const cached = MODEL_CACHE.get(id);
  const g = new THREE.Group();

  if (cached) {
    const mesh = new THREE.Mesh(cached.geo, GEAR_MATERIAL);
    mesh.castShadow = true;
    g.add(mesh);
    const muzzle = new THREE.Object3D();
    muzzle.position.copy(cached.muzzle);
    muzzle.name = 'muzzle';
    g.add(muzzle);
    g.userData.muzzle = muzzle;
    return g;
  }

  // Merge the whole gun into one vertex-coloured buffer on a shared metallic
  // material: seven meshes per weapon times twenty combatants is a lot of draw
  // calls to spend on something the size of a shoebox.
  const part = new PartMesh();
  const add = (geo, colour, x, y, z) => {
    _wm.makeTranslation(x, y, z);
    part.add(geo, _wm, colour);
  };

  let muzzleZ = -0.3;

  switch (id) {
    case 'pistol': {
      add(box(0.055, 0.11, 0.24), GUNMETAL, 0, 0.03, -0.06);   // slide
      add(box(0.05, 0.14, 0.07), POLYMER, 0, -0.07, 0.03);     // grip
      add(box(0.03, 0.045, 0.05), GUNMETAL, 0, -0.02, 0.0);    // trigger guard
      add(rod(0.031, 0.07), STEEL, 0, 0.0, -0.02);             // cylinder
      add(rod(0.016, 0.11), STEEL, 0, 0.035, -0.2);            // barrel
      muzzleZ = -0.26;
      break;
    }
    case 'smg': {
      add(box(0.06, 0.11, 0.34), POLYMER, 0, 0.02, -0.08);
      add(box(0.05, 0.15, 0.07), POLYMER, 0, -0.08, 0.05);     // grip
      add(box(0.045, 0.2, 0.06), GUNMETAL, 0, -0.11, -0.05);   // magazine
      add(rod(0.017, 0.15), STEEL, 0, 0.035, -0.29);           // barrel
      add(box(0.05, 0.06, 0.16), GUNMETAL, 0, 0.0, 0.16);      // stock
      add(box(0.02, 0.03, 0.02), STEEL, 0, 0.085, -0.2);       // front sight
      muzzleZ = -0.37;
      break;
    }
    case 'rifle': {
      add(box(0.06, 0.1, 0.42), POLYMER, 0, 0.02, -0.1);       // receiver
      add(box(0.05, 0.15, 0.07), POLYMER, 0, -0.08, 0.08);     // grip
      add(box(0.05, 0.24, 0.07), GUNMETAL, 0, -0.12, -0.02);   // magazine (curved-ish)
      add(rod(0.018, 0.25), STEEL, 0, 0.035, -0.42);           // barrel
      add(box(0.055, 0.06, 0.16), POLYMER, 0, 0.03, -0.28);    // handguard
      add(box(0.055, 0.08, 0.2), POLYMER, 0, -0.01, 0.24);     // stock
      add(box(0.03, 0.05, 0.03), GUNMETAL, 0, 0.09, -0.02);    // rear sight
      add(box(0.025, 0.05, 0.025), STEEL, 0, 0.085, -0.36);    // front post
      muzzleZ = -0.55;
      break;
    }
    case 'shotgun': {
      add(box(0.06, 0.09, 0.4), WOOD, 0, 0.01, -0.08);
      add(rod(0.021, 0.35), STEEL, 0, 0.05, -0.34);            // barrel
      add(rod(0.019, 0.31), GUNMETAL, 0, 0.005, -0.32);        // tube magazine
      add(box(0.06, 0.055, 0.12), WOOD, 0, 0.0, -0.3);         // pump
      add(box(0.05, 0.13, 0.06), WOOD, 0, -0.06, 0.06);        // grip
      add(box(0.055, 0.1, 0.22), WOOD, 0, -0.02, 0.24);        // stock
      muzzleZ = -0.53;
      break;
    }
  }

  const geo = part.build();
  const muzzlePos = new THREE.Vector3(0, 0.04, muzzleZ);
  MODEL_CACHE.set(id, { geo, muzzle: muzzlePos });

  const mesh = new THREE.Mesh(geo, GEAR_MATERIAL);
  mesh.castShadow = true;
  g.add(mesh);
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(muzzlePos);
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
  m.position.set(0.012, -0.055, -0.035);
  m.rotation.set(Math.PI / 2, 0, 0); // hand hangs down: rotate barrel to forward
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

  decayBloom(dt) {
    this.bloom = Math.max(0, this.bloom - dt * (this.def.bloomMax * 1.6 + 0.02));
  }

  addAmmo(n) {
    const before = this.reserve;
    this.reserve = Math.min(this.def.maxReserve, this.reserve + n);
    return this.reserve - before;
  }
}
