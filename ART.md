# Art direction

**Stylised low-poly. Not photoreal, not cartoon.** Readable shapes, flat
surfaces, a small saturated palette, and light that models form rather than
texture. Decided 13 Aug 2026; this file is the reference every asset decision
answers to.

## Why this direction and not the other one

The game had four art registers in one frame — photoscanned 2 K brick,
flat-shaded untextured guns, a caricature crew, semi-realistic riot police — and
players read mixed fidelity as unfinished, not as stylised.

Pushing everything *up* toward the photoscans was the obvious fix and the wrong
one. It would mean finding realistic, rigged, redistributable free characters
and weapons, which barely exist — the mismatch happened precisely because they
don't. Pulling everything *down* to a stylised register is the cheaper
direction, and it inverts which assets are the problem:

| Asset | Under photoreal | Under stylised |
|---|---|---|
| Quaternius city kit, nature, cars | outlier | **on-model** |
| Supplied low-poly gun pack | outlier | **on-model** |
| Vendorman crew | outlier | **on-model** |
| ambientCG / Poly Haven scans | on-model | outlier — remove |
| Armoured police, Caveirão | on-model | flatten to fit |

More than half of what is already in the game was in the target style the whole
time. It was sitting next to photogrammetry, which is why it looked wrong.

And it pays for itself three times over. The photoscanned layer is 19 MB of the
37 MB download, most of the texture memory, and every normal and ARM map is a
per-fragment cost on a phone. This direction is the art fix, the download fix
and part of the performance fix, in one decision.

## Rules

**Texture budget.** 512 px is the ceiling and it is for hero surfaces only —
walls the player stands against. Props get 64 px, and that is not a typo: at 64
with a soft resize a scanned barrel becomes a painterly one and costs 2 KB
instead of 300. Anything that can be a flat colour should be a flat colour.

**No normal maps.** Stylised shading wants form from geometry and light, not
from a bump. Derived normals off, scanned normals gone. This also deletes a
texture fetch per fragment.

**Roughness is uniform per material class**, not mapped:

| Class | Roughness | Metalness |
|---|---|---|
| Plaster, concrete, brick | 0.92 | 0 |
| Painted metal, sheeting | 0.55 | 0.35 |
| Glass | 0.12 | 0.5 |
| Cloth, skin | 0.85 | 0 |

**Three materials per object, maximum.** A prop needing four is a prop that
needs merging.

**Silhouette carries the read.** If an object is unrecognisable as a black
shape, no texture will save it. This is the test for whether a prop earns its
place at all.

## Palette

Sampled from Rocinha and Complexo do Alemão photography, then cut to what a
hillside actually repeats. Nine arbitrary plaster tints became five.

| Role | Hex | Where |
|---|---|---|
| Render, warm | `#d8a15c` | the commonest painted wall |
| Render, pale | `#e8ddc8` | sun-bleached plaster |
| Render, cool | `#7fa0a8` | the blue-green that turns up everywhere |
| Render, rose | `#c97a6d` | terracotta and faded pink |
| Render, mint | `#9dbf9a` | the pale green |
| Brick | `#9c5f47` | exposed block where render has gone |
| Zinc | `#a8adb2` | roof sheeting, the map's second-largest surface |
| Concrete | `#b6b4ac` | stairs, slabs, retaining walls |
| Shadow | `#2a3138` | the cool the whole scene shades toward |

Accent colours — Flamengo red, police navy, the bunting — sit outside this and
stay saturated. They are the only saturated things in frame, which is what makes
them read.

## Light

One warm key from the sky, one cool ambient, shadows toward `#2a3138` rather
than toward black. Contrast comes from the palette, not from the exposure.

## Out of scope

Photorealism. PBR scan sets. Parallax and displacement. Per-object normal maps.
Screen-space reflections. Any asset that cannot be redistributed from a public
repository.

## What this costs

Detail, honestly. A scanned wall has grime, chips and mortar variation that a
64 px painterly texture does not. The trade is coherence and a game that runs,
and coherence is what "polished" actually means at this scale — a small game
that agrees with itself reads as finished; a big one that does not reads as
broken.
