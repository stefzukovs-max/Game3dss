# Performance

## Read this first

Every performance number this project produced before 13 Aug 2026 was measured
in headless Chromium on **swiftshader**, a software rasteriser. Those numbers
describe how fast a CPU can pretend to be a GPU. They say nothing about the
phone this game is for, and they were quoted often enough that it is worth
stating plainly: **the game's frame rate has never been measured.**

This file is where real measurements go. It is not full yet.

## How to take a reading

1. Open the game on the device: <https://stefzukovs-max.github.io/Game3dss/>
2. Start a run and play until wave 2 — the scene is not fully populated before
   then and an early reading flatters it.
3. Show the overlay: **F3** on a keyboard, or **four fingers on the screen** at
   once on a phone.
4. Let it settle for ten seconds. `n=240` in the bottom row means the sample
   buffer is full.
5. Photograph it and record the numbers below.

## What the overlay says

```
p50 11.4ms   p99 28.9ms   head 5.3ms
fps 88   draws 587   tris 2538k
tier high   dpr 2.00   shadows on
1180×820   n=240
```

| Field | Meaning |
|---|---|
| `p50` | the median frame. What it usually feels like. |
| `p99` | the worst frame in a hundred. What ruins a shot. |
| `head` | milliseconds left in a 60 Hz frame at p50. Negative means it is already dropping frames. |
| `draws` | draw calls last frame, from `renderer.info`. |
| `tris` | triangles submitted last frame. |
| `tier` | which quality tier the device picked for itself. |
| `dpr` | device pixel ratio being rendered at. |

p50 and p99 rather than an average FPS on purpose. An average hides the one
frame in fifty that takes 90 ms, and that frame is the one that lands while you
are tracking a target.

## Targets

| | Target | Why |
|---|---|---|
| p50 | ≤ 12 ms | leaves ~5 ms of the 16.7 ms frame for spikes |
| p99 | ≤ 25 ms | one dropped frame is survivable; a run of them is not |
| Draw calls | ≤ 220 | enforced by `npm run budget` |
| Triangles | ≤ 450,000 | enforced by `npm run budget` |

`npm run budget` exits non-zero above the last two, so it can gate a commit.
`npm run budget -- --report` prints the breakdown without failing.

## Baselines

Nothing here yet. Fill a row in and the rest of the work can be judged against
it instead of against a guess.

| Date | Device | Browser | Tier | p50 | p99 | Draws | Tris | Notes |
|---|---|---|---|---|---|---|---|---|
| _(empty)_ | | | | | | | | |

### Scene contents, for reference

Measured with `npm run budget` at commit `46e7878`. These are accurate as a
count of what is in the scene — they are **not** frame times.

| | Count |
|---|---|
| Triangles | 2,538,574 |
| Draw calls | 587 |
| Instances | 4,744 |
| Collision boxes | 1,574 |

80% of those triangles were undecimated photoscanned props. See the Phase 1
notes in the commit history for what was done about it.
