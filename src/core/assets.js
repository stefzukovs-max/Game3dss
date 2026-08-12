import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * Runtime loader for the CC0 asset pack in assets/.
 *
 * Everything here is optional. If assets/manifest.json is missing — a fresh
 * clone before `npm run assets`, or a deploy that chose not to ship 28 MB —
 * `ready` stays false and the game runs on the procedural path it always had.
 * That is not defensive padding: it keeps the repo playable at ~1 MB and means
 * a failed CDN fetch degrades the picture instead of breaking the game.
 *
 * What gets loaded is tier-dependent, because the constraint on a phone is
 * texture memory rather than download size. A 1024² RGBA texture is 4 MB
 * resident before mipmaps; twelve materials × three maps at that size is over
 * a hundred megabytes of VRAM, which a mid-range phone will not give you. So
 * the low tier takes colour only and lets the normal and ARM maps go.
 *
 * (The real fix for both axes is KTX2/Basis compressed textures, which stay
 * compressed in VRAM. That needs a WASM transcoder shipped alongside, so it is
 * a deliberate not-yet rather than an oversight.)
 */

const BASE = 'assets/';

/** Props worth their bytes when the budget is tight — silhouette, not clutter. */
const LOW_TIER_PROPS = new Set([
  'modular_chainlink_fence', 'modular_electricity_poles', 'exterior_aircon_unit',
  'rollershutter_door', 'propane_tank', 'Barrel_01', 'Barrel_02', 'old_tyre',
  'concrete_road_barrier', 'metal_trash_can',
]);

export class AssetLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.ready = false;
    this.manifest = null;
    this.materials = new Map();   // slug → { color, normal, arm }
    this.props = new Map();       // id   → THREE.Group (template, never added to a scene)
    this.models = new Map();      // slot → THREE.Group (weapons, vehicles, bodies)
    this.clips = [];              // AnimationClips from the animation library
    this.env = null;              // PMREM cubemap for scene.environment
    this.background = null;       // equirect DataTexture for scene.background
    this.sun = null;              // { dir: Vector3, color: Color }
  }

  /**
   * @param {'low'|'medium'|'high'} tier
   * @param {(fraction:number, message:string)=>void} onProgress
   */
  async load(tier, onProgress = () => {}) {
    try {
      const res = await fetch(BASE + 'manifest.json');
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      this.manifest = await res.json();
    } catch (e) {
      console.info('[assets] no asset pack found, using the procedural path —', e.message);
      return false;
    }

    this.tier = tier;
    const detail = tier !== 'low';
    const props = (this.manifest.props ?? [])
      .filter((p) => detail || LOW_TIER_PROPS.has(p.id));

    // Weight the progress bar by real work, not by item count: the HDRI is one
    // file but a tenth of the wait, and a bar that sticks at 4% then jumps is
    // worse than no bar.
    const units = 8 + (this.manifest.materials?.length ?? 0) * (detail ? 3 : 1)
      + props.length * 3 + (this.manifest.models?.length ?? 0);
    let done = 0;
    const tick = (n, msg) => { done += n; onProgress(Math.min(done / units, 1), msg); };

    await this._loadHdri(this.manifest.hdris?.[0], () => tick(8, 'Lighting the sky…'));

    for (const m of this.manifest.materials ?? []) {
      await this._loadMaterial(m, detail);
      tick(detail ? 3 : 1, 'Unpacking surfaces…');
    }

    if (props.length) {
      const gltf = new GLTFLoader();
      for (const p of props) {
        await this._loadProp(gltf, p);
        tick(3, 'Dressing the hillside…');
      }
    }

    // Weapons and vehicles are small and always needed — a player without a
    // gun is not a playable state, so these load on every tier.
    if (this.manifest.models?.length) {
      const gltf = new GLTFLoader();
      /*
       * A merged kit is one file holding many modules, so every one of its
       * manifest entries names the same file and differs only by `part`.
       * Loading per entry would fetch and upload the whole kit forty times
       * over, so files are loaded once and the parts looked up inside.
       */
      const loaded = new Map();
      for (const m of this.manifest.models) {
        try {
          let g = loaded.get(m.file);
          if (!g) {
            g = await gltf.loadAsync(BASE + m.file);
            g.scene.traverse((o) => {
              if (!o.isMesh) return;
              o.castShadow = true;
              o.receiveShadow = true;
              if (o.material) o.material.envMapIntensity = 1.0;
            });
            loaded.set(m.file, g);
          }
          const node = m.part ? g.scene.getObjectByName(m.part) : g.scene;
          if (node) this.models.set(`${m.pack}:${m.slot}`, node);
          else console.warn(`[assets] ${m.pack}/${m.slot}: no part "${m.part}" in the kit`);
          // the animation pack is carried for its clips, not its mesh
          if (m.pack === 'anim' && g.animations?.length) this.clips = g.animations;
        } catch (e) {
          console.warn(`[assets] model ${m.pack}/${m.slot} failed —`, e.message);
        }
      }
    }

    this.ready = true;
    return true;
  }

  /* ── environment ──────────────────────────────────────────────────── */
  async _loadHdri(entry, done) {
    if (!entry) return;
    try {
      const tex = await new HDRLoader().loadAsync(BASE + entry.file);
      tex.mapping = THREE.EquirectangularReflectionMapping;

      this.sun = extractSun(tex);

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      this.env = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();

      this.background = tex;
    } catch (e) {
      console.warn('[assets] HDRI failed, keeping the procedural sky —', e.message);
    }
    done();
  }

  /* ── materials ────────────────────────────────────────────────────── */
  async _loadMaterial(entry, detail) {
    const loader = (this._tl ??= new THREE.TextureLoader());
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const set = {};

    const get = async (key, srgb) => {
      const file = entry.maps[key];
      if (!file) return null;
      const t = await loader.loadAsync(BASE + file);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(aniso, 8);
      return t;
    };

    try {
      set.color = await get('color', true);
      if (detail) {
        set.normal = await get('normal', false);
        set.arm = await get('arm', false);
      }
      this.materials.set(entry.slug, set);
    } catch (e) {
      console.warn(`[assets] material ${entry.slug} failed —`, e.message);
    }
  }

  /* ── props ────────────────────────────────────────────────────────── */
  async _loadProp(gltf, entry) {
    try {
      const g = await gltf.loadAsync(BASE + entry.file);
      const root = g.scene;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        // Poly Haven ships these lit for offline renderers; the environment
        // here is a real HDRI, so let it drive the specular response fully
        if (o.material) o.material.envMapIntensity = 1.0;
      });
      this.props.set(entry.id, root);
    } catch (e) {
      console.warn(`[assets] prop ${entry.id} failed —`, e.message);
    }
  }

  /* ── accessors ────────────────────────────────────────────────────── */

  /** A fresh instance of a packed model, e.g. `model('guns', 'rifle')`. */
  model(pack, slot) {
    const t = this.models.get(`${pack}:${slot}`);
    return t ? t.clone(true) : null;
  }

  /** The raw texture set for a slug, or null when the pack is absent. */
  material(slug) { return this.materials.get(slug) ?? null; }

  /**
   * A MeshStandardMaterial built from a slug.
   *
   * `repeat` is in world metres per tile — the scanned materials are all
   * roughly one square metre of real surface, so a repeat of 2 means the
   * pattern spans two metres, and every wall in the map tiles consistently
   * without per-surface fiddling.
   */
  standard(slug, { repeat = 1, ...opts } = {}) {
    const s = this.materials.get(slug);
    if (!s?.color) return null;

    const tile = (t) => {
      if (!t) return null;
      const c = t.clone();
      c.needsUpdate = true;
      c.repeat.set(repeat, repeat);
      return c;
    };

    const m = new THREE.MeshStandardMaterial({
      map: tile(s.color), roughness: 1, metalness: 1, envMapIntensity: 1, ...opts,
    });

    if (s.normal) m.normalMap = tile(s.normal);
    if (s.arm) {
      // one image, three jobs: R = occlusion, G = roughness, B = metalness.
      // `channel = 0` is the important line — aoMap defaults to the second UV
      // set, which this geometry does not have, so without it every surface
      // samples uv1 = (0,0) and reads as uniformly occluded.
      const arm = tile(s.arm);
      m.aoMap = arm;
      m.roughnessMap = arm;
      m.metalnessMap = arm;
      arm.channel = 0;
    } else {
      // colour-only tier: no map to carry the range, so bake sane constants
      m.roughness = opts.roughness ?? 0.9;
      m.metalness = opts.metalness ?? 0;
    }
    return m;
  }

  /**
   * A fresh instance of a prop. Geometry and materials are shared with the
   * template, so a hundred tyres cost a hundred transforms and one mesh
   * upload.
   */
  prop(id) {
    const t = this.props.get(id);
    return t ? t.clone(true) : null;
  }

  /** Named sub-object of a modular kit, cloned. Kits ship many variants. */
  propPart(id, name) {
    const t = this.props.get(id);
    if (!t) return null;
    const found = t.getObjectByName(name);
    return found ? found.clone(true) : null;
  }

  /** Every top-level part name in a kit — used by the placement code. */
  propParts(id) {
    const t = this.props.get(id);
    if (!t) return [];
    const names = [];
    t.traverse((o) => { if (o.isMesh || o.isGroup) names.push(o.name); });
    return names;
  }
}

/**
 * Find the sun in an equirectangular HDR.
 *
 * Rather than trust a hand-typed vector to match whatever sky is loaded, read
 * it out of the pixels: threshold to the brightest 0.02% of the upper
 * hemisphere, take the luminance-weighted centroid of what is left, and turn
 * that back into a direction. Swap the HDRI and the shadows move with it.
 *
 * The inverse of three's own `equirectUv`:
 *   u = atan2(d.z, -d.x) / 2π + 0.5
 *   v = asin(d.y) / π + 0.5
 * HDRLoader sets flipY, so texture v = 1 - row/height.
 */
function extractSun(tex) {
  const { data, width: w, height: h } = tex.image;
  const f16 = data instanceof Uint16Array;
  const lum = (i) => {
    const r = f16 ? fromHalf(data[i]) : data[i];
    const g = f16 ? fromHalf(data[i + 1]) : data[i + 1];
    const b = f16 ? fromHalf(data[i + 2]) : data[i + 2];
    return { l: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b };
  };

  // upper hemisphere only: a bright patch of ground is not the sun
  const half = Math.floor(h / 2);
  let peak = 0;
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < w; x++) peak = Math.max(peak, lum((y * w + x) * 4).l);
  }
  if (peak <= 0) return null;

  const cut = peak * 0.55;
  let sx = 0, sy = 0, sz = 0, sr = 0, sg = 0, sb = 0, wsum = 0;
  for (let y = 0; y < half; y++) {
    const v = 1 - (y + 0.5) / h;
    const theta = (v - 0.5) * Math.PI;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    for (let x = 0; x < w; x++) {
      const c = lum((y * w + x) * 4);
      if (c.l < cut) continue;
      const phi = ((x + 0.5) / w - 0.5) * Math.PI * 2;
      sx += -cosT * Math.cos(phi) * c.l;
      sy += sinT * c.l;
      sz += cosT * Math.sin(phi) * c.l;
      sr += c.r; sg += c.g; sb += c.b;
      wsum += c.l;
    }
  }
  if (wsum <= 0) return null;

  const dir = new THREE.Vector3(sx, sy, sz).divideScalar(wsum);
  if (dir.lengthSq() < 1e-8) return null;
  dir.normalize();

  // normalise the hue but not the level — the light's intensity stays an
  // authored value, because a physically-derived one swings by 100× between
  // HDRIs and would make swapping skies a lighting rebuild every time
  const m = Math.max(sr, sg, sb) || 1;
  return { dir, color: new THREE.Color(sr / m, sg / m, sb / m) };
}

/** IEEE half → float. HDRLoader defaults to HalfFloatType. */
function fromHalf(bits) {
  const s = (bits & 0x8000) ? -1 : 1;
  const e = (bits >> 10) & 0x1f;
  const f = bits & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
