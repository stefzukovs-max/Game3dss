# Credits

Every third-party asset in this repository is **CC0 1.0 Universal (Public Domain Dedication)** — a public
domain dedication. CC0 permits copying, modifying and redistributing the files,
including commercially and including shipping the raw files inside a game, with
no attribution requirement.

This file exists anyway. The people below scanned, photographed and modelled
this material and gave it away; naming them costs nothing and is the right
thing to do.

Full licence text: <https://creativecommons.org/publicdomain/zero/1.0/>

Everything is fetched and baked by `npm run assets` from
`tools/asset-manifest.js`. Nothing here is hand-edited.

---

## Materials — ambientCG

<https://ambientcg.com> · licence: <https://ambientcg.com/license>

ambientCG releases all assets under CC0. Each entry below is downloaded as a
1K JPG set, then baked to WebP: sRGB colour, an OpenGL-convention normal map,
and an ARM map packing ambient occlusion, roughness and metalness into the R,
G and B channels of a single image.

| In-game name | ambientCG asset | Baked size | Used for |
|---|---|---|---|
| `cloth` | [Fabric030](https://ambientcg.com/view?id=Fabric030) | 512px | shirt and trouser weave |
| `denim` | [Fabric077](https://ambientcg.com/view?id=Fabric077) | 512px | jeans twill |
| `leather` | [Leather028](https://ambientcg.com/view?id=Leather028) | 512px | vests, boots, holsters, gear straps |

## 3D props — Poly Haven

<https://polyhaven.com> · licence: <https://polyhaven.com/license>

Poly Haven releases all assets under CC0 and funds the work through Patreon.
Each prop is downloaded as glTF, then welded, pruned, texture-compressed to
WebP and vertex-quantized into a single `.glb`.

| Asset | Author(s) | Used for |
|---|---|---|
| [Modular Chainlink Fence](https://polyhaven.com/a/modular_chainlink_fence) | James Ray Cock, Amal Kumar | court cage, alley fencing, rooftop edges |
| [Modular Electricity Poles](https://polyhaven.com/a/modular_electricity_poles) | James Ray Cock | power poles along the lanes |
| [Modular Electric Cables](https://polyhaven.com/a/modular_electric_cables) | Kuutti Siitonen | the overhead cable tangle between poles |
| [Modular Metal Gutter](https://polyhaven.com/a/modular_metal_gutter) | Maxim Domnin | downpipes and gutters on the facades |
| [Modular Pipes](https://polyhaven.com/a/modular_pipes) | Kuutti Siitonen | surface plumbing runs up the walls |
| [Modular Fire Escape](https://polyhaven.com/a/modular_fire_escape) | Juniix | external stair runs on the taller blocks |
| [Exterior Aircon Unit](https://polyhaven.com/a/exterior_aircon_unit) | Monsta3D | wall-mounted air conditioners |
| [Rollershutter Door](https://polyhaven.com/a/rollershutter_door) | MP | closed shopfronts at street level |
| [Rollershutter Window 01](https://polyhaven.com/a/rollershutter_window_01) | MP | graffitied shutters |
| [Rollershutter Window 03](https://polyhaven.com/a/rollershutter_window_03) | MP | graffitied shutters (variant) |
| [Utility Box 01](https://polyhaven.com/a/utility_box_01) | James Ray Cock | street-side utility cabinets |
| [Utility Box 02](https://polyhaven.com/a/utility_box_02) | James Ray Cock | street-side utility cabinets (large) |
| [Water Manhole Cover](https://polyhaven.com/a/water_manhole_cover) | Raunox | manholes in the plaza and road |
| [Propane Tank](https://polyhaven.com/a/propane_tank) | Slinc | gas bottles beside doorways |
| [Small Lpg Tank](https://polyhaven.com/a/small_lpg_tank) | Ulan Cabanilla | gas bottles beside doorways (small) |
| [Barrel_01](https://polyhaven.com/a/Barrel_01) | Jorge Camacho | steel drums used as cover |
| [Barrel 02](https://polyhaven.com/a/Barrel_02) | Jorge Camacho | blue plastic water drums |
| [Barrel Stove](https://polyhaven.com/a/barrel_stove) | MP | burnt-out oil drums |
| [Metal Trash Can](https://polyhaven.com/a/metal_trash_can) | GurJas Studios | bins along the lanes |
| [Old Tyre](https://polyhaven.com/a/old_tyre) | MP | tyre piles |
| [Cardboard Box 01](https://polyhaven.com/a/cardboard_box_01) | Rahul Chaudhary | stacked boxes behind the market |
| [Concrete Road Barrier](https://polyhaven.com/a/concrete_road_barrier) | Amal Kumar | police roadblock at the foot of the hill |
| [Covered Car](https://polyhaven.com/a/covered_car) | MP | the tarped car on the lower street |
| [Ladder Sectioned 01](https://polyhaven.com/a/ladder_sectioned_01) | MP | ladders against the roof edges |
| [Wooden Ladder](https://polyhaven.com/a/wooden_ladder) | Miroslav Turura | ladders against the roof edges (timber) |
| [School Chair 01](https://polyhaven.com/a/SchoolChair_01) | Ethan Place | plastic chairs outside the bar |

## Character rig and animation — Quaternius

<https://quaternius.com/packs/universalanimationlibrary.html> · licence: CC0 1.0,
stated in `assets/models/rig/LICENSE-quaternius.txt`

`assets/models/rig/universal.glb` is the Universal Animation Library
[Standard], downloaded from the author's mirror on OpenGameArt:
<https://opengameart.org/content/universal-animation-library>

One file carries the skeleton, forty-six clips and a rigged Mannequin. That
matters more than the animation count. Everything the characters in this game
looked wrong about came from a seam — a body from one pack re-bound onto a
skeleton from another by a Blender script — and the defects it produced were
invisible in the bind pose and only appeared once something moved: vertices
weighted to bones on the far side of the body, hands welded to hips by the
mesh reduction, a scale track that inflated one shoulder three and a half
times and threw the weapon arm over the character's head.

Here the mesh and the clips were bound together by the person who made them,
so there is nothing to retarget and nothing to re-bind. The figure is authored
in metres and stands 1.779 m with its feet at exactly zero, so it needs no
unit correction either — the previous rig ran at 45% of its intended size for
the life of the project because it did.

`npm run check:rig` asserts all of it against the shipped file.

## Weapons and vehicles — Quaternius

<https://quaternius.com> · licence: CC0 1.0, stated in each pack's
`License.txt`

Quaternius hand-models and releases large game-asset packs under CC0. These are
the only two things neither photogrammetry library carries — firearms and
vehicles — and a third-person shooter needs both on screen constantly.

The packs ship as OBJ, FBX and .blend with no glTF, and are distributed through
itch.io, which has no plain file URLs. `tools/itch-fetch.mjs` performs the
download handshake and `tools/obj-to-glb.mjs` converts the OBJ sets by running
them through three.js's own loaders in a headless browser, so `npm run assets`
still reproduces everything from a clean clone.

| In-game slot | Model | Pack | Kind |
|---|---|---|---|
| `police` | Cop | [Realistic Car Pack](https://quaternius.com) | cars |
| `sedan` | NormalCar1 | [Realistic Car Pack](https://quaternius.com) | cars |
| `sedan2` | NormalCar2 | [Realistic Car Pack](https://quaternius.com) | cars |
| `suv` | SUV | [Realistic Car Pack](https://quaternius.com) | cars |
| `taxi` | Taxi | [Realistic Car Pack](https://quaternius.com) | cars |
| `body` | Superhero_Male_FullBody.gltf | [Realistic Car Pack](https://quaternius.com) | people |
| `hair_buzz` | Hair_Buzzed.gltf | [Realistic Car Pack](https://quaternius.com) | people |
| `hair_part` | Hair_SimpleParted.gltf | [Realistic Car Pack](https://quaternius.com) | people |
| `hair_long` | Hair_Long.gltf | [Realistic Car Pack](https://quaternius.com) | people |
| `beard` | Hair_Beard.gltf | [Realistic Car Pack](https://quaternius.com) | people |
| `clips` | UAL1_Standard.glb | [Realistic Car Pack](https://quaternius.com) | anim |
| `door_wood` | Door_1 | [Realistic Car Pack](https://quaternius.com) | city |
| `door_panel` | Door_2 | [Realistic Car Pack](https://quaternius.com) | city |
| `door_metal` | Door_3 | [Realistic Car Pack](https://quaternius.com) | city |
| `doorframe_metal` | DoorFrame_Metal_Single | [Realistic Car Pack](https://quaternius.com) | city |
| `doorframe_wood` | DoorFrame_Wooden | [Realistic Car Pack](https://quaternius.com) | city |
| `window_brick` | Brick_Window_Square_Single | [Realistic Car Pack](https://quaternius.com) | city |
| `window_brick_trim` | Brick_Window_Trim_Single | [Realistic Car Pack](https://quaternius.com) | city |
| `window_inset` | Brick_Inset_Window | [Realistic Car Pack](https://quaternius.com) | city |
| `window_metal` | Metal_Window | [Realistic Car Pack](https://quaternius.com) | city |
| `window_metal_half` | Metal_Window_Half | [Realistic Car Pack](https://quaternius.com) | city |
| `window_full` | Metal_FullWindow | [Realistic Car Pack](https://quaternius.com) | city |
| `shop_wall` | Metal_FirstFloor_Wall | [Realistic Car Pack](https://quaternius.com) | city |
| `shop_wall_alt` | Metal_FirstFloor_Wall_1 | [Realistic Car Pack](https://quaternius.com) | city |
| `shop_window` | Metal_FirstFloor_Window | [Realistic Car Pack](https://quaternius.com) | city |
| `brick_plain` | Brick_Plain_1 | [Realistic Car Pack](https://quaternius.com) | city |
| `brick_worn` | Brick_Plain_3 | [Realistic Car Pack](https://quaternius.com) | city |
| `brick_panel` | Brick_Plain_4 | [Realistic Car Pack](https://quaternius.com) | city |
| `brick_double` | Brick_RedWhite_DoubleWindow | [Realistic Car Pack](https://quaternius.com) | city |
| `brick_column` | Brick_Column_Small | [Realistic Car Pack](https://quaternius.com) | city |
| `brick_base` | Brick_BottomTrim | [Realistic Car Pack](https://quaternius.com) | city |
| `brick_cap` | Brick_TopTrim | [Realistic Car Pack](https://quaternius.com) | city |
| `cornice_metal` | Cornice_Metal_Center | [Realistic Car Pack](https://quaternius.com) | city |
| `rail_run` | Stairs_Rails_Metal_Straight_1 | [Realistic Car Pack](https://quaternius.com) | city |
| `rail_run_long` | Stairs_Rails_Metal_Straight_2 | [Realistic Car Pack](https://quaternius.com) | city |
| `rail_flight` | Stairs_Rails_Metal | [Realistic Car Pack](https://quaternius.com) | city |
| `stoop` | Stairs_Entrance_Concrete | [Realistic Car Pack](https://quaternius.com) | city |
| `entrance` | Entrance_Concrete_2x1 | [Realistic Car Pack](https://quaternius.com) | city |
| `wall_guard` | Trim_Wall_Guard | [Realistic Car Pack](https://quaternius.com) | city |
| `ac_unit` | Prop_ACUnit | [Realistic Car Pack](https://quaternius.com) | city |
| `bollard` | Prop_Bollard | [Realistic Car Pack](https://quaternius.com) | city |
| `drain` | Prop_Drain | [Realistic Car Pack](https://quaternius.com) | city |
| `manhole` | Prop_ManholeCover | [Realistic Car Pack](https://quaternius.com) | city |
| `planter` | Prop_Planter_Single | [Realistic Car Pack](https://quaternius.com) | city |
| `road` | Street_2Lane | [Realistic Car Pack](https://quaternius.com) | city |
| `road_bare` | Street_2Lane_noSidewalk | [Realistic Car Pack](https://quaternius.com) | city |
| `road_tee` | Street_TIntersection | [Realistic Car Pack](https://quaternius.com) | city |
| `kerb` | Sidewalk_Straight_3m | [Realistic Car Pack](https://quaternius.com) | city |
| `kerb_corner` | Sidewalk_Corner_Flat_3m | [Realistic Car Pack](https://quaternius.com) | city |
| `kerb_planter` | Sidewalk_Planter | [Realistic Car Pack](https://quaternius.com) | city |
| `crosswalk` | Decal_Crosswalk | [Realistic Car Pack](https://quaternius.com) | city |
| `centreline` | Decal_DoubleYellow_Straight | [Realistic Car Pack](https://quaternius.com) | city |
| `palm1` | PalmTree_1 | [Realistic Car Pack](https://quaternius.com) | nature |
| `palm2` | PalmTree_2 | [Realistic Car Pack](https://quaternius.com) | nature |
| `palm3` | PalmTree_3 | [Realistic Car Pack](https://quaternius.com) | nature |
| `plant1` | Plant_1 | [Realistic Car Pack](https://quaternius.com) | nature |
| `plant2` | Plant_3 | [Realistic Car Pack](https://quaternius.com) | nature |
| `plant3` | Plant_5 | [Realistic Car Pack](https://quaternius.com) | nature |
| `bush1` | Bush_1 | [Realistic Car Pack](https://quaternius.com) | nature |
| `bush2` | Bush_2 | [Realistic Car Pack](https://quaternius.com) | nature |
| `tree1` | CommonTree_2 | [Realistic Car Pack](https://quaternius.com) | nature |
| `tree2` | CommonTree_5 | [Realistic Car Pack](https://quaternius.com) | nature |

## Environment lighting — Poly Haven

| HDRI | Author(s) | Used for |
|---|---|---|
| [Autumn Field (Pure Sky)](https://polyhaven.com/a/autumn_field_puresky) | Jarod Guest, Sergej Majboroda | sky dome, image-based lighting and sun direction |

---

## Deliberately excluded

Three sources of "free" characters were found, evaluated and left out. Two of
them fail on licensing, because "free to download" and "free to redistribute"
are not the same thing and this repository redistributes everything it ships;
the third is clean but wrong for the job.

**Mixamo characters — including three.js's own `Soldier.glb`.** Mixamo is the
obvious source for rigged, animated, roughly-realistic humans, and
`examples/models/gltf/Soldier.glb` in the three.js repository is a Mixamo
export. Adobe's terms license Mixamo content for *use* in a project; they are
not a clear grant to redistribute the raw model files in a public repository,
and downloading from Mixamo requires an Adobe account, so the files cannot be
fetched reproducibly by `npm run assets` either. Ambiguous redistribution
rights, so: excluded.

**Renderpeople / Human Alloy free samples.** Photoscanned, genuinely
photorealistic, free to download — and the licence explicitly forbids
redistribution. Unambiguous, so: excluded.

### The characters

The characters are real rigged humans driven by skeletal animation. Two CC0
packs from Quaternius make it work, and neither is any use on its own:

| Pack | What it gives |
|---|---|
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | An anatomically proportioned rigged human — 12.5k triangles, real hands, separate hair and eye meshes |
| [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | 43 named clips on the same skeleton |

The clips are the ones a third-person shooter actually needs: `Idle_Loop`,
`Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Crouch_Idle_Loop`,
`Crouch_Fwd_Loop`, `Pistol_Aim_Down` / `_Neutral` / `_Up`,
`Pistol_Shoot`, `Pistol_Reload`, `Hit_Chest`, `Hit_Head`,
`Death01`, `Jump_Start` / `_Loop` / `_Land`, `Roll`.

**The risk was retargeting**, and it was measured rather than assumed: the two
packs share all 65 bones, and every track of a clip binds to the base
character's skeleton with no renaming. The animation library drives the body
directly.

**The physique needed changing first.** The pack's body is called "Superhero"
and is built like one, and since the clothing is cut from that surface it
inherits every bulge — dressed, it read as a bodybuilder in body paint.
`reshapeBody` contracts the mesh around each bone, perpendicular to that
bone's own run, and blends the result by skin weight the way skinning does.
Every centre is a point *on* its bone, so the bone stays the axis of its limb
and the skeleton does not have to move with the skin.

**The gap was clothing.** The base pack ships bare bodies, and no CC0 outfit
set anywhere shares this skeleton — the only modular outfit pack built for it
is fantasy armour. So the clothing is cut out of the body itself, in
`src/entities/outfit.js`: a garment is the region of the body it covers,
copied and pushed a centimetre or two along its own normals, so it inherits the
pack's skin weights and deforms correctly with no rigging step. Bone weights
give the soft boundaries — an armhole follows the shoulder — and cut planes give
the hard ones.

A shell offset along the body's normals is a perfect cast of it, so a garment
left there shows the abdominals through the shirt and the trousers read as
leggings. Each one is relaxed against its own neighbours a few times to lift it
off the muscle relief, and the clearance that smoothing eats is pushed back out
afterwards.

Anything that would not deform is modelled and hung off a bone instead:
helmets, visors, night vision, caps, magazine pouches, shoulder radios,
drop-leg holsters, knee pads, the gold chain — and footwear, because a shell
around a foot is a shrink-wrapped foot, with toes and no sole. The pack's
hairstyles go on the head bone the same way.

`npm run check:outfits` reports what every preset cut, so a garment that
comes back empty shows up as a number rather than as an absence in a
screenshot, and `npm run rig` prints the measurements the cuts are written
against.

### The map

The hillside is procedural, on scanned materials. What the
[Downtown City MegaKit](https://quaternius.itch.io/downtown-city-megakit)
adds is the fittings: modelled doors hung in the openings the houses punch,
metal handrails down the staircases, and bollards, drains, manholes and
planters along the lower street.

It is curated against the setting rather than against the pack. Exposed brick
and roll-up shopfronts are what a hillside like this is built from; the slate
roofs, stone cornices and ornamental trim are a north-Atlantic downtown and
would look imported, so they are left in the archive along with the pack's
three pre-built buildings.

The kit is merged into one glTF at build time. Every module references the same
handful of 2048² PBR sets, so one file per module would embed forty copies of
the brickwork; merged first, dedup collapses them and the whole kit costs
2.5 MB. `npm run kit` prints every module's grid size.

### Supplied assets

These models did not come from the CC0 libraries above. They were supplied by
the project owner, and their provenance and licence are theirs to state, not
ours — the pipeline only records them, and `npm run assets` cannot rebuild them
from a clean clone.

| Slot | Model | Used for |
|---|---|---|
| `police:caveirao` | Armoured personnel truck | the battalion vehicle at the foot of the hill |
| `landmark:christ` | Hilltop statue | the summit landmark, in place of the plain cross |
| `slums:kit` | Modular slum blocks | stacked hillside housing |
| `people:crew` | Street vendor in a Flamengo shirt | every crew character — a finished figure, so it wears no cut clothing |
| `people:armored` | Police Officer Redford (BitGem Proto Series) | every police character — a finished figure, so it wears no cut clothing |
| `guns:pistol` | Makarov PM | the sidearm |
| `guns:smg` | Compact SMG | the submachine gun |
| `guns:rifle` | AK-74 | the assault rifle |
| `guns:shotgun` | Wood-stocked carbine | the shotgun slot — the pack has no pump gun, and this is the closest silhouette it has |
| `guns:dmr` | SVD Dragunov | the marksman rifle |
| `guns:launcher` | RPG-7 | the rocket launcher |
| `police:caveirao` | Armoured personnel truck | the battalion vehicle at the foot of the hill |
| `landmark:christ` | Hilltop statue | the summit landmark, in place of the plain cross |
| `slums:kit` | Modular slum blocks | stacked hillside housing |
| `people:crew` | Street vendor in a Flamengo shirt | every crew character — a finished figure, so it wears no cut clothing |
| `people:armored` | Police Officer Redford (BitGem Proto Series) | every police character — a finished figure, so it wears no cut clothing |
| `guns:pistol` | Makarov PM | the sidearm |
| `guns:smg` | Compact SMG | the submachine gun |
| `guns:rifle` | AK-74 | the assault rifle |
| `guns:shotgun` | Wood-stocked carbine | the shotgun slot — the pack has no pump gun, and this is the closest silhouette it has |
| `guns:dmr` | SVD Dragunov | the marksman rifle |
| `guns:launcher` | RPG-7 | the rocket launcher |

Two of them are worth a second look before this is published anywhere
commercial. `police:interceptor` is a real-world vehicle carrying a
manufacturer's trademarked design and badging, and `landmark:christ` is a
copyrighted sculpture whose rights are actively enforced. Model licences,
trademark and the copyright in a depicted work are three separate questions,
and a licence to use a mesh answers only the first of them.

It arrived as a `.blend` and an `.fbx`. The FBX is the one that looks
convenient and it is unusable — three's FBX importer mangles this file's
pivots, and the car loads as a heap of detached panels. The `.blend` exports
cleanly through Blender, which is the path `tools/fbx-to-glb.mjs` and
`tools/bake-glb.mjs` document.

**Still excluded** for licensing, unchanged: Mixamo (no clear redistribution
grant, and an account is required) and Renderpeople / Human Alloy free samples
(licence forbids redistribution).
