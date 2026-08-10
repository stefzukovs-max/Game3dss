# Cross Hill

A browser-based **third-person shooter** set on a Brazilian favela hillside.
Two factions fight over the same hill: the **Hillside Crew** hold it, the
**Tactical Battalion** try to take it. Pick a side, pick an operator, survive the
waves.

Runs in any modern browser, **desktop or phone**. No build step, no bundler,
no downloads at runtime — three.js is vendored and every texture, sound and
3D model is generated procedurally at load time.

```bash
npm start          # → http://localhost:8080
```

> Everything in this game is invented — the crews, the units, the operators and
> the hill itself. Stylised, non-realistic depiction; no real people,
> organisations or places.

---

## Controls

| | |
|---|---|
| `W A S D` | move |
| `Mouse` | look · `LMB` fire · `RMB` aim down sights |
| `Shift` | sprint (drains stamina) |
| `Space` | jump · `Ctrl` / `C` crouch |
| `R` | reload · `1`–`4` / wheel weapons · `Q` swap shoulder |
| `E` | operator ability · `G` grenade |
| `M` | toggle radar rotation · `Esc` pause |

## On mobile

Touch is a first-class path, not a shim. The game detects a touch device and
switches over completely: no pointer lock, no click-to-play card, on-screen
controls, and a graphics tier picked from what the device reports about itself.

- **Left thumb** — a stick that *floats to wherever your thumb lands*, so you
  never hunt for a fixed pad. Push it to the edge to sprint.
- **Right thumb** — drag anywhere on the right of the screen to look. Touches
  are tracked per finger, so you can keep dragging while the other thumb holds
  FIRE.
- **Buttons** — fire, aim toggle, jump, crouch, reload, weapon swap, ability
  and grenade, plus an on-screen pause. Sized in `vmin` and laid out inside the
  safe area, so notches and home bars don't eat them. There's a left-handed
  layout in the settings.
- **Aim assist** — on by default. It nudges your aim toward a hostile already
  near the crosshair and fades to nothing at the edge of the cone; a thumb
  can't make 1° corrections. Roughly twice the pull on touch as on a mouse, and
  it can be switched off.
- **Portrait is gated** with a rotate prompt rather than squeezed — the HUD
  needs the width.
- **Quality tiers** (Auto/Low/Medium/High) scale resolution, shadows, draw
  distance, character detail, effects and crowd size together. A phone
  typically lands on Low: no shadows, 1× pixel ratio, simplified character
  meshes, fog pulled in to 165 m and the enemy cap dropped from 18 to 8.

---

## The roster

Ten operators, five per faction, covering the same five pillars so both sides
play fair — but the flavour of each pillar is opposite. The hill improvises;
the battalion is issued.

| | The Hillside Crew | Tactical Battalion |
|---|---|---|
| **Recon** | **Kite** — the lookout. Fastest on foot, +40% jump, silent. Sends a kite up to outline every hostile through walls. | **Pvt. Camargo** — the eyes. +60% reserve ammo, vacuums pickups. Puts a drone up to mark the map. |
| **Heavy** | **Boulder** — the door. 150 HP / 60 armour, −25% damage taken, no stagger. Drops a scrap barricade. | **Sgt. Stone** — the wall. 160 HP / 80 armour, −30% frontal damage. Plants a ballistic shield. |
| **Marksman** | **Queen** — the patience. Crouched ADS removes bloom entirely, +30% headshots. Holds her breath for perfect accuracy. | **Cpl. Lira** — the angle. +45% damage on perfectly still shots. Thermal optic sees through walls. |
| **Disruptor** | **Smoke** — the fireworks. Double throwables, +35% explosive damage. Molotov leaves a pool of fire. | **Lt. Sayuri** — the doorway. +35% damage inside 8 m, fast ADS. Flashbangs the room first. |
| **Support** | **Doc** — the stitches. Regenerates 3× faster out of combat. Drops a field kit for the crew. | **Capt. Duarte** — the order. Nearby squadmates +15% damage. Calls a push: +25% move and fire rate. |

Each operator has one **passive** that changes how you move or shoot constantly,
and one **active** (`E`) that changes how the fight reads for a few seconds.

---

## The map

```
┌──────────────────────────────────────────────────────────┐  -78
│  T4  THE CROSS       cross · lookout · THE BIG ROOF      │   crew spawn
├──────────────────────────────────────────────────────────┤  -42
│  T3  THE ROOFTOPS    WATER TOWER · DANCEHALL · roofs     │
├──────────────────────────────────────────────────────────┤  -16
│  T2  THE GRAND STAIR THE CHAPEL + bell tower · alleys    │
├──────────────────────────────────────────────────────────┤   +6
│  T1  THE MARKET      CORNER SHOP · THE CAGE (pitch)      │
├──────────────────────────────────────────────────────────┤  +30
│  T0  THE PLAZA       BANDSTAND · squad cars · van stop   │  police spawn
└──────────────────────────────────────────────────────────┘  +66
```

Five terraces, **three lanes**, and a fourth vertical one:

- **West — The Alleys.** Tight, blind corners. Fastest, most dangerous.
- **Mid — The Grand Stair.** The staircase spine, with a solid divider down
  the middle so it isn't a firing lane. The chapel tower watches all of it.
- **East — The Ramp Road.** The vehicle road: long, gentle ramps and the open
  football cage. Rewards rifles.
- **Rooftops.** From T2 upward, reachable by external stairs. Flanks every
  choke — and leaves you skylined.

Every terrace transition has **at least one climb per lane**, and every street
band runs the full width so you can rotate sideways without giving up height.

---

## How it works

Everything is generated at load: the hillside, the houses, the brick and
graffiti textures (painted into `<canvas>`), the weapon models, the characters,
and all the audio (synthesised through WebAudio — gunshots are a noise burst
through a swept resonant filter plus a low body thump, distance-attenuated and
low-passed).

**Characters** are built from capsules, spheres and a lathed torso rather than
boxes. Two things keep that cheap enough to run twenty of them on a phone:
every part of a limb — sleeve, skin, glove, strapping — is baked into one
buffer with **vertex colours** under a single shared material, so a limb is one
draw call instead of four; and outfits come from a small preset table, so the
merged geometry for "crew grunt #3" is built once and shared by everyone
wearing it. Spawning an agent allocates nothing but a handful of `Object3D`s.

```
src/
  core/       utils (RNG, geometry batching, game clock) · collision · input · audio
  world/      favela.js  — the authored map + procedural infill
              navgraph.js — waypoint graph derived from the map's lanes and climbs
              textures.js — every texture, painted to canvas
  entities/   character.js (procedural rig) · player.js · ai.js · roster.js
  systems/    weapons · combat (hitscan + pooled FX) · abilities · pickups · waves · upgrades
  ui/         hud.js · minimap.js
```

A few decisions worth knowing about:

**Collision is exact, not approximate.** The level is built entirely from
axis-aligned boxes, so the same box list serves the renderer, the character
controller, the hitscan raycasts and the AI's line-of-sight checks. The whole
level bakes down to ~30 draw calls via a geometry batcher.

**Navigation is a waypoint graph, not a navmesh.** The map is deliberately
built as terraces + three lanes + fixed climbs, so the graph falls straight out
of the layout (~150 nodes). Routing is A* over real edge lengths — hop-count
search picks absurd routes when a staircase two metres away and one forty
metres away are both "one edge".

**The AI probes walkability by marching, not raycasting.** A ray can't tell a
staircase from a wall. Agents step along a heading in short hops carrying the
ground height with them, so a tread is walkable and a retaining lip isn't.

**Waves can't deadlock.** If an agent stops making progress and nobody can see
it, it's quietly redeployed to a waypoint closer to the objective and out of
line of sight — a wave only ends when every attacker is down, so one agent
wedged in a corner would otherwise stall the run forever.

**Simulation time, not wall-clock.** Fire rates, reloads, cooldowns and buffs
all read an internal clock advanced by `dt`, so the game behaves identically
under a frame drop and nothing ticks down while paused.

**Shots converge on the crosshair.** The aim ray starts at the camera, which
sits behind and to one side of the shooter, so firing straight down it would
send bullets past whatever you were pointing at. Instead the game finds what
the crosshair is over — world geometry *and* characters — and fires from the
muzzle at that point. Leaving characters out of that test is worse than it
sounds: the convergence point lands on the wall behind your target and the
muzzle offset then carries the shot wide by more than the weapon's own spread.

---

## Development tools

The game is verified headlessly with Playwright (Chromium is expected at
`/opt/pw-browsers/chromium`). Start the server first, then:

```bash
npm run check:map        # asserts every staircase and ramp is walkable end to end,
                         # and dumps live AI nav state (path, waypoint, stuck timers)
npm run check:sim        # drives the game at a fixed 60 Hz timestep for N minutes —
                         # waves, AI, combat and the draft, far faster than real time
npm run check:mobile     # emulates a phone and drives the game through synthetic
                         # touch events: stick, look drag and every button
npm run check:shooting   # weapon bench on open ground, isolated from allied fire
npm run shots            # captures menu / HUD / map screenshots
npm run shots:chars      # close-up portraits of both factions' character rigs
```

The weapon bench is worth a note: it measures the **player's own** damage
output, never the dummy's health. Reading the dummy's health folds in every
ally shooting the same target, which swamps the signal completely — an earlier
version of this harness did exactly that and reported pure noise.

`check:sim` is the useful one: it reports wave progression, how far up the hill
the attackers have travelled, kills, score and any thrown exception.

---

## Credits

Built with [three.js](https://threejs.org) (MIT, vendored in `vendor/`).
Everything else is original.

---

## Language

Everything the player reads is in English. The setting is still a Brazilian
hillside, but faction, operator, ability and location names are all English so
the game is legible without translation.

One implementation note that matters: gameplay code branches on stable perk
**ids** (`passive.id === 'logistics'`), never on display names. An earlier
version compared against the Portuguese names directly, which meant renaming
an operator's perk would have silently switched off its effect.
