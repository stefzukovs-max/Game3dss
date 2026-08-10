# Morro do Cruzeiro

A browser-based **third-person shooter** set on a Brazilian favela hillside.
Two factions fight over the same hill: the **Comando do Morro** hold it, the
**Batalhão Tático** try to take it. Pick a side, pick an operator, survive the
waves.

Runs in any modern browser. No build step, no bundler, no downloads at
runtime — three.js is vendored and every texture, sound and 3D model is
generated procedurally at load time.

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

Touch controls (stick + buttons) appear automatically on touch devices.

---

## The roster

Ten operators, five per faction, covering the same five pillars so both sides
play fair — but the flavour of each pillar is opposite. The hill improvises;
the battalion is issued.

| | Comando do Morro | Batalhão Tático |
|---|---|---|
| **Recon** | **Pipa** — the lookout. Fastest on foot, +40% jump, silent. Sends a kite up to outline every hostile through walls. | **Sd. Camargo** — the eyes. +60% reserve ammo, vacuums pickups. Puts a drone up to mark the map. |
| **Heavy** | **Bagre** — the door. 150 HP / 60 armour, −25% damage taken, no stagger. Drops a scrap barricade. | **Sgt. Muralha** — the wall. 160 HP / 80 armour, −30% frontal damage. Plants a ballistic shield. |
| **Marksman** | **Rainha** — the patience. Crouched ADS removes bloom entirely, +30% headshots. Holds her breath for perfect accuracy. | **Cb. Lira** — the angle. +45% damage on perfectly still shots. Thermal optic sees through walls. |
| **Disruptor** | **Fumaça** — the fireworks. Double throwables, +35% explosive damage. Molotov leaves a pool of fire. | **Ten. Sayuri** — the doorway. +35% damage inside 8 m, fast ADS. Flashbangs the room first. |
| **Support** | **Doutor** — the stitches. Regenerates 3× faster out of combat. Drops a field kit for the crew. | **Cap. Duarte** — the order. Nearby squadmates +15% damage. Calls a push: +25% move and fire rate. |

Each operator has one **passive** that changes how you move or shoot constantly,
and one **active** (`E`) that changes how the fight reads for a few seconds.

---

## The map

```
┌──────────────────────────────────────────────────────────┐  -78
│  T4  O CRUZEIRO      cross · mirante · A LAJE GRANDE     │   gang spawn
├──────────────────────────────────────────────────────────┤  -42
│  T3  AS LAJES        CAIXA D'ÁGUA · O BAILE · rooftops   │
├──────────────────────────────────────────────────────────┤  -16
│  T2  O ESCADÃO       A IGREJINHA + bell tower · alleys   │
├──────────────────────────────────────────────────────────┤   +6
│  T1  O MERCADO       O MERCADINHO · O CAMPO (pitch)      │
├──────────────────────────────────────────────────────────┤  +30
│  T0  A PRAÇA         O CORETO · viaturas · kombi stop    │  police spawn
└──────────────────────────────────────────────────────────┘  +66
```

Five terraces, **three lanes**, and a fourth vertical one:

- **West — Os Becos.** Tight alleys and blind corners. Fastest, most dangerous.
- **Mid — O Escadão.** The grand staircase spine, with a solid divider down
  the middle so it isn't a firing lane. The chapel tower watches all of it.
- **East — A Ladeira.** The vehicle road: long, gentle ramps and the open
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

---

## Development tools

The game is verified headlessly with Playwright (Chromium is expected at
`/opt/pw-browsers/chromium`). Start the server first, then:

```bash
npm run check:map        # asserts every staircase and ramp is walkable end to end,
                         # and dumps live AI nav state (path, waypoint, stuck timers)
npm run check:sim        # drives the game at a fixed 60 Hz timestep for N minutes —
                         # waves, AI, combat and the draft, far faster than real time
npm run check:shooting   # measures sustained hit rate against a stationary target
npm run shots            # captures menu / HUD / map screenshots for visual review
```

`check:sim` is the useful one: it reports wave progression, how far up the hill
the attackers have travelled, kills, score and any thrown exception.

---

## Credits

Built with [three.js](https://threejs.org) (MIT, vendored in `vendor/`).
Everything else is original.
