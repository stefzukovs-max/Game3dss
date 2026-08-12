/**
 * The curated asset list.
 *
 * Everything here is CC0 1.0 (public domain dedication) from two sources:
 *
 *   ambientCG   — https://ambientcg.com/license   (site-wide CC0, all assets)
 *   Poly Haven  — https://polyhaven.com/license   (site-wide CC0, all assets)
 *
 * CC0 explicitly permits redistributing the raw files inside a project, which
 * is why these two are the whole list: no attribution is legally required, no
 * per-asset terms to audit, nothing that goes stale if the upstream site
 * changes its mind. `tools/fetch-assets.mjs` still writes a full CREDITS.md,
 * because crediting people whose work you are using for free is the decent
 * thing to do whether or not a licence forces you to.
 *
 * Deliberately NOT here, and why — see CREDITS.md for the long version:
 *   • Mixamo characters (incl. three.js's own Soldier.glb, which is a Mixamo
 *     export): Adobe's terms cover *use* in a project but are not a
 *     redistribution grant for the raw model files, and downloading needs an
 *     Adobe login. Ambiguous, so it stays out.
 *   • Renderpeople / Human Alloy free samples: free to download, licence
 *     forbids redistribution. Clearly out.
 *
 * `tile` is how many metres of real surface one repeat of the texture covers.
 * The scans do not publish a physical size, so these are judged by eye against
 * a known reference (brick courses, corrugation pitch, tile grout spacing) and
 * checked in-engine — get it wrong and a wall reads as dollhouse brick or as a
 * smear. The map's UVs are already world-scaled, so the game only needs
 * `repeat = 2 / tile` and every surface tiles consistently without per-wall
 * fiddling.
 *
 * `size` is the square texture resolution the fetch tool bakes down to. Hero
 * surfaces the player stands next to get 1024; anything seen at distance or
 * used as a small prop gets 512, which is invisible in motion and roughly
 * quarters the bytes.
 */

/* ── ambientCG materials ─────────────────────────────────────────────────
 * `id`    ambientCG asset id (the fetch tool pulls <id>_1K-JPG.zip)
 * `slug`  what the game calls it
 * `use`   note for CREDITS.md, so the file explains itself
 */
export const MATERIALS = [
  // walls — the favela reads as brick-and-patchy-render more than anything else
  { slug: 'brick_red',      id: 'Bricks097',        tile: 1.0, size: 1024, use: 'primary exposed-brick walls' },
  { slug: 'brick_orange',   id: 'Bricks051',        tile: 1.0, size: 1024, use: 'newer brick walls' },
  { slug: 'plaster_orange', id: 'PaintedPlaster013', tile: 2.0, size: 1024, use: 'orange render peeling to brick' },
  { slug: 'plaster_yellow', id: 'PaintedPlaster007', tile: 2.0, size: 1024, use: 'yellow render peeling to brick' },
  { slug: 'plaster_worn',   id: 'PaintedPlaster008', tile: 2.0, size: 1024, use: 'blue-grey render peeling to brick' },
  { slug: 'plaster_blue',   id: 'PaintedPlaster002', tile: 2.0, size: 512,  use: 'painted blue walls' },
  { slug: 'plaster_green',  id: 'PaintedPlaster003', tile: 2.0, size: 512,  use: 'painted green walls' },
  { slug: 'plaster_white',  id: 'PaintedPlaster016', tile: 2.0, size: 512,  use: 'weathered white walls' },
  // The tint base for the whole painted-wall palette, so it has to be almost
  // featureless: anything with strong blotches repeats into visible camouflage
  // across a 12 m wall no matter what colour it is multiplied by.
  { slug: 'plaster_plain',  id: 'Plaster006',       tile: 2.5, size: 1024, use: 'neutral render, tinted per house colour' },
  { slug: 'concrete_wall',  id: 'Concrete034',      tile: 2.0, size: 1024, use: 'raw concrete walls and stair flanks' },
  { slug: 'concrete_slab',  id: 'Concrete031',      tile: 2.0, size: 1024, use: 'terrace slabs and rooftops' },

  // roofs
  { slug: 'corrugated',       id: 'CorrugatedSteel005', tile: 1.2, size: 1024, use: 'bare galvanised roof sheeting' },
  { slug: 'corrugated_red',   id: 'CorrugatedSteel002', tile: 1.2, size: 512,  use: 'red-painted roof sheeting' },
  { slug: 'corrugated_green', id: 'CorrugatedSteel006A', tile: 1.2, size: 512, use: 'green-painted roof sheeting' },

  // ground
  { slug: 'asphalt',      id: 'Asphalt033',      tile: 2.0, size: 1024, use: 'the road at the foot of the hill' },
  { slug: 'paving_brick', id: 'PavingStones092', tile: 1.0, size: 1024, use: 'plaza and market paving' },
  { slug: 'paving_stone', id: 'PavingStones128', tile: 2.0, size: 512,  use: 'stair treads and landings' },
  { slug: 'dirt',         id: 'Ground079S',      tile: 2.0, size: 1024, use: 'dirt alleys and unpaved ground' },
  { slug: 'rock',         id: 'Rock030',         tile: 2.0, size: 512,  use: 'exposed hillside rock' },

  // detail
  { slug: 'planks',  id: 'Planks023A', tile: 2.0, size: 512, use: 'timber shack walls, doors, market stalls' },
  { slug: 'rust',    id: 'Metal021',   tile: 2.0, size: 512, use: 'rusted metal, water tanks, railings' },
  { slug: 'azulejo', id: 'Tiles101',   tile: 0.6, size: 512, use: 'tiled shopfronts' },

  // characters — normal + roughness only; base colour stays vertex-tinted per outfit
  { slug: 'cloth',   id: 'Fabric030',  tile: 0.25, size: 512, maps: ['normal', 'arm'], use: 'shirt and trouser weave' },
  { slug: 'denim',   id: 'Fabric077',  tile: 0.25, size: 512, maps: ['normal', 'arm'], use: 'jeans twill' },
  { slug: 'leather', id: 'Leather028', tile: 0.3, size: 512, maps: ['normal', 'arm'], use: 'vests, boots, holsters, gear straps' },
];

/* ── Poly Haven props ────────────────────────────────────────────────────
 * All photogrammetry or scan-derived, all CC0. `size` picks the glTF texture
 * LOD to start from and the resolution to bake down to.
 */
export const PROPS = [
  // structure — the things that actually change the map's silhouette
  { id: 'modular_chainlink_fence',   size: 1024, use: 'court cage, alley fencing, rooftop edges' },
  // the pole kit ships eight variants sharing one atlas; at 1024 it alone was
  // 3.9 MB, and poles are almost never the thing you are standing next to
  { id: 'modular_electricity_poles', size: 512, use: 'power poles along the lanes' },
  { id: 'modular_electric_cables',   size: 512,  use: 'the overhead cable tangle between poles' },
  { id: 'modular_metal_gutter',      size: 512,  use: 'downpipes and gutters on the facades' },
  { id: 'modular_pipes',             size: 512,  use: 'surface plumbing runs up the walls' },
  { id: 'modular_fire_escape',       size: 512,  use: 'external stair runs on the taller blocks' },

  // facade dressing
  { id: 'exterior_aircon_unit',   size: 512, use: 'wall-mounted air conditioners' },
  { id: 'rollershutter_door',     size: 512, use: 'closed shopfronts at street level' },
  { id: 'rollershutter_window_01', size: 512, use: 'graffitied shutters' },
  { id: 'rollershutter_window_03', size: 512, use: 'graffitied shutters (variant)' },
  { id: 'utility_box_01',         size: 512, use: 'street-side utility cabinets' },
  { id: 'utility_box_02',         size: 512, use: 'street-side utility cabinets (large)' },
  { id: 'water_manhole_cover',    size: 512, use: 'manholes in the plaza and road' },

  // clutter — cover, silhouette breakup, and the stuff that sells "lived in"
  { id: 'propane_tank',         size: 512, use: 'gas bottles beside doorways' },
  { id: 'small_lpg_tank',       size: 512, use: 'gas bottles beside doorways (small)' },
  { id: 'Barrel_01',            size: 512, use: 'steel drums used as cover' },
  { id: 'Barrel_02',            size: 512, use: 'blue plastic water drums' },
  { id: 'barrel_stove',         size: 512, use: 'burnt-out oil drums' },
  { id: 'metal_trash_can',      size: 512, use: 'bins along the lanes' },
  { id: 'old_tyre',             size: 512, use: 'tyre piles' },
  { id: 'cardboard_box_01',     size: 512, use: 'stacked boxes behind the market' },
  { id: 'concrete_road_barrier', size: 512, use: 'police roadblock at the foot of the hill' },
  { id: 'covered_car',          size: 1024, use: 'the tarped car on the lower street' },
  { id: 'ladder_sectioned_01',  size: 512, use: 'ladders against the roof edges' },
  { id: 'wooden_ladder',        size: 512, use: 'ladders against the roof edges (timber)' },
  { id: 'SchoolChair_01',       size: 512, use: 'plastic chairs outside the bar' },
];

/* ── Poly Haven HDRI ─────────────────────────────────────────────────────
 * A "puresky" capture: sky only, no ground geometry baked into the lower
 * hemisphere, which is exactly right when the ground is your own map.
 *
 * Picked for a hard sun disc sitting well clear of the horizon over a deep
 * blue sky. That combination is what gives long raking shadows *and* a cool
 * blue fill in shadow, and warm-key/cool-fill is most of why a real
 * photograph looks three-dimensional and a flat ambient render does not.
 */
export const HDRIS = [
  { id: 'autumn_field_puresky', res: '1k', use: 'sky dome, image-based lighting and sun direction' },
];

/* ── Quaternius model packs (CC0, via itch.io) ───────────────────────────
 * Hand-modelled rather than scanned, and the only source of the two things
 * photogrammetry libraries do not carry: firearms and vehicles. Poly Haven has
 * neither, and a shooter needs both.
 *
 * `pick` maps a game slot to a model in the pack. The gun pack ships 40
 * weapons and 15 attachments; the game uses four, chosen for silhouette —
 * they have to be distinguishable from each other at a glance in a fight.
 */
/*
 * Models that are not fetched.
 *
 * These arrive by hand — supplied by the project owner rather than pulled from
 * a CC0 library — so the baked GLB is committed and the pipeline only records
 * it. `npm run assets` cannot rebuild them from a clean clone, which is exactly
 * why they are listed separately from everything else rather than quietly
 * mixed in: the provenance and the licence are not ours to assert.
 *
 * `tools/fbx-to-glb.mjs` and `tools/bake-glb.mjs` are the two steps that made
 * the file, so it can be remade if the source is supplied again.
 */
export const LOCAL_MODELS = [
  {
    pack: 'police', slot: 'caveirao',
    file: 'models/police/caveirao.glb',
    source: 'supplied', name: 'Armoured personnel truck',
    use: 'the battalion vehicle at the foot of the hill',
    scale: 1,
    note: 'supplied by the project owner; not from the CC0 libraries above',
  },
  {
    pack: 'landmark', slot: 'christ',
    file: 'models/landmark/christ.glb',
    source: 'supplied', name: 'Hilltop statue',
    // 39.6 m tall as modelled, which is the real thing's height; the summit
    // terrace needs something a player can stand next to
    scale: 0.30,
    use: 'the summit landmark, in place of the plain cross',
    note: 'supplied by the project owner; not from the CC0 libraries above',
  },
  {
    pack: 'slums', slot: 'kit',
    file: 'models/slums/kit.glb',
    source: 'supplied', name: 'Modular slum blocks',
    use: 'stacked hillside housing',
    scale: 1,
    note: 'supplied by the project owner; not from the CC0 libraries above',
  },
  /*
   * The supplied street vendor is deliberately absent.
   *
   * It was sent to be the crew's character model and it cannot be one: it has
   * no armature, so not one of the game's animations will play on it, and it is
   * modelled in a stylised cartoon proportion — a metre tall, oversized head,
   * flat colours — against a roster of realistic 1.8 m figures. Standing it in
   * the market as scenery was the fallback, and next to the police it would
   * have read as a bug rather than as a bystander. Registering it anyway would
   * put 0.45 MB in front of every player for something never drawn.
   */
  {
    pack: 'police', slot: 'interceptor',
    file: 'models/police/interceptor.glb',
    source: 'supplied',
    name: 'Police interceptor sedan',
    use: 'the patrol cars at the foot of the hill',
    // exported from the .blend in metres, so it needs no rescaling
    scale: 1,
    note: 'supplied by the project owner; not from the CC0 libraries above',
  },
];

export const MODEL_PACKS = [
  {
    id: 'guns', user: 'quaternius', slug: '50-lowpoly-guns',
    name: 'Ultimate Gun Pack', dir: 'OBJ', size: 512,
    use: 'the four carried weapons',
    pick: {
      pistol: 'Pistol_2',
      smg: 'SubmachineGun_1',
      rifle: 'AssaultRifle_1',
      shotgun: 'Shotgun_1',
    },
  },
  {
    id: 'cars', user: 'quaternius', slug: 'lowpoly-cars',
    name: 'Realistic Car Pack', dir: 'OBJ', size: 512,
    use: 'the police patrol car and civilian traffic',
    pick: {
      police: 'Cop',
      sedan: 'NormalCar1',
      sedan2: 'NormalCar2',
      suv: 'SUV',
      taxi: 'Taxi',
    },
  },
  /*
   * The characters. Two packs that only work together: the base pack is a
   * rigged human with no animation, the library is 43 clips with no character
   * worth shipping. They share all 65 bones, so the clips drive the body with
   * no retargeting — measured, not assumed.
   *
   * `files` picks named glTF out of the archive instead of converting OBJ:
   * these ship as glTF already, and going through the OBJ path would throw the
   * skeleton away.
   */
  {
    id: 'people', user: 'quaternius', slug: 'universal-base-characters',
    name: 'Universal Base Characters', size: 512, format: 'gltf',
    use: 'the rigged body every character is built on',
    /*
     * The hairstyles ship as separate files rigged to the head bone. They are
     * taken from the "Origin at 0" set and attached rigidly: hair does not
     * deform on a shooter at this distance, and a rigid child of the head bone
     * costs nothing next to a second skinned mesh per character.
     */
    files: {
      body: 'Superhero_Male_FullBody.gltf',
      hair_buzz: 'Hair_Buzzed.gltf',
      hair_part: 'Hair_SimpleParted.gltf',
      hair_long: 'Hair_Long.gltf',
      beard: 'Hair_Beard.gltf',
    },
  },
  {
    id: 'anim', user: 'quaternius', slug: 'universal-animation-library',
    name: 'Universal Animation Library', size: 256, format: 'gltf',
    use: '43 animation clips on the same skeleton',
    files: { clips: 'UAL1_Standard.glb' },
  },
  /*
   * The city kit. Textured PBR modular architecture — brick facades, real
   * doors and windows, metal shopfronts, stair railings, street furniture and
   * road tiles with lane markings.
   *
   * Curated hard, and against the setting rather than against the pack. Exposed
   * red brick, roll-up shopfronts and improvised stair rails are exactly what a
   * hillside like this is built from, so those come. The slate roofs, stone
   * cornices and ornamental trim are a north-Atlantic downtown and would look
   * imported, so they stay out — as do the pack's three pre-built buildings,
   * which are 3 MB each and assembled for a different city.
   *
   * `merge` is the important flag. Every module references the same handful of
   * 2048² texture sets, so writing one GLB per module embeds thirty copies of
   * the brickwork; merged into a single document first, dedup collapses them to
   * one and the whole kit costs less than two of the buildings would.
   */
  {
    id: 'city', user: 'quaternius', slug: 'downtown-city-megakit',
    name: 'Downtown City MegaKit', size: 1024, format: 'gltf', merge: 'kit',
    use: 'facade detail, shopfronts, stair rails, street furniture and the road',
    pick: {
      /* openings — these replace the punched holes in the procedural houses */
      door_wood: 'Door_1',
      door_panel: 'Door_2',
      door_metal: 'Door_3',
      doorframe_metal: 'DoorFrame_Metal_Single',
      doorframe_wood: 'DoorFrame_Wooden',
      window_brick: 'Brick_Window_Square_Single',
      window_brick_trim: 'Brick_Window_Trim_Single',
      window_inset: 'Brick_Inset_Window',
      window_metal: 'Metal_Window',
      window_metal_half: 'Metal_Window_Half',
      window_full: 'Metal_FullWindow',

      /* street-level shopfronts along the lower road */
      shop_wall: 'Metal_FirstFloor_Wall',
      shop_wall_alt: 'Metal_FirstFloor_Wall_1',
      shop_window: 'Metal_FirstFloor_Window',

      /* brick facade modules for the blocks at the foot of the hill */
      brick_plain: 'Brick_Plain_1',
      brick_worn: 'Brick_Plain_3',
      brick_panel: 'Brick_Plain_4',
      brick_double: 'Brick_RedWhite_DoubleWindow',
      brick_column: 'Brick_Column_Small',
      brick_base: 'Brick_BottomTrim',
      brick_cap: 'Brick_TopTrim',
      cornice_metal: 'Cornice_Metal_Center',

      /* the stairs the whole map is built around finally get handrails */
      rail_run: 'Stairs_Rails_Metal_Straight_1',
      rail_run_long: 'Stairs_Rails_Metal_Straight_2',
      rail_flight: 'Stairs_Rails_Metal',
      stoop: 'Stairs_Entrance_Concrete',
      entrance: 'Entrance_Concrete_2x1',
      wall_guard: 'Trim_Wall_Guard',

      /* street furniture */
      ac_unit: 'Prop_ACUnit',
      bollard: 'Prop_Bollard',
      drain: 'Prop_Drain',
      manhole: 'Prop_ManholeCover',
      planter: 'Prop_Planter_Single',

      /* the road at the foot of the hill */
      road: 'Street_2Lane',
      road_bare: 'Street_2Lane_noSidewalk',
      road_tee: 'Street_TIntersection',
      kerb: 'Sidewalk_Straight_3m',
      kerb_corner: 'Sidewalk_Corner_Flat_3m',
      kerb_planter: 'Sidewalk_Planter',
      crosswalk: 'Decal_Crosswalk',
      centreline: 'Decal_DoubleYellow_Straight',
    },
  },
  {
    id: 'nature', user: 'quaternius', slug: '150-lowpoly-nature-models',
    name: 'Ultimate Nature Pack', dir: 'OBJ', size: 512,
    use: 'palms, plants and bushes on the hillside',
    // Palms first: a Rio hillside is not a pine forest, and the cones these
    // replace were the single most toy-like thing left on the map.
    pick: {
      palm1: 'PalmTree_1', palm2: 'PalmTree_2', palm3: 'PalmTree_3',
      plant1: 'Plant_1', plant2: 'Plant_3', plant3: 'Plant_5',
      bush1: 'Bush_1', bush2: 'Bush_2',
      tree1: 'CommonTree_2', tree2: 'CommonTree_5',
      grass: 'Grass_1',
    },
  },
];

export const LICENSE = {
  name: 'CC0 1.0 Universal (Public Domain Dedication)',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
};

export const SOURCES = {
  quaternius: { name: 'Quaternius', url: 'https://quaternius.com', license: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  ambientcg: { name: 'ambientCG', url: 'https://ambientcg.com', license: 'https://ambientcg.com/license' },
  polyhaven: { name: 'Poly Haven', url: 'https://polyhaven.com', license: 'https://polyhaven.com/license' },
};
