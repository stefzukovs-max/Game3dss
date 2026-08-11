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
    files: { body: 'Superhero_Male_FullBody.gltf' },
  },
  {
    id: 'anim', user: 'quaternius', slug: 'universal-animation-library',
    name: 'Universal Animation Library', size: 256, format: 'gltf',
    use: '43 animation clips on the same skeleton',
    files: { clips: 'UAL1_Standard.glb' },
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
