# Art direction

**Stylised, in the Brawl Stars register.** Chunky proportions, readable
shapes, flat surfaces, a saturated palette, and high-key light with lifted
shadows. Decided 13 Aug 2026, moved to the fully stylised end the same day;
this file is the reference every asset decision answers to.

## The build

Characters are roughly **four and a quarter heads tall** — real people are
seven and a half, and so were these models. That one ratio is more of the
difference between the two looks than the palette or the lighting, because it
is what the eye reads first and from furthest away.

No remodelling: it is a table of per-bone scale factors in
`src/entities/chibi.js`, multiplied into the rest pose and into every clip's
scale tracks at load. `npm run proportions` measures what the table actually
produced and fails if the figure stops fitting the 1.82 m collision capsule
or stops reading as stylised. `?realistic` on the URL boots the original
human proportions for comparison.

**Hands and feet are the exception, and it is an asset problem, not a
choice.** The reference has shovels for hands; this does not, because the
supplied police body was re-bound onto the game's skeleton and its bind pose
is very slightly off its rest pose. At scale 1 that is invisible. Scale a
bone and the residual is multiplied instead of cancelling, and the squad
renders as a heap of blue the size of a building. The head survives a 3.5×
local factor; the extremities came apart at 1.4. So the extremities inherit
their parent's scale exactly and nothing amplifies. The long version is in
`chibi.js`; the fix is to re-export that body with its bind pose baked.

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

**High key, lifted shadows, saturated ambient.** Late morning rather than
golden hour: the sun sits at about forty degrees so most of what you see is
lit, because shadow is where saturation goes to die. Form comes from the
hemisphere gradient and contact occlusion rather than from long cast shadows.

Four decisions carry it, and all four are reversible in a line:

| | | why |
|---|---|---|
| tone map | `NeutralToneMapping` | ACES desaturates as it compresses highlights, so a red shirt in sun drifts to white — right for film, wrong for the one thing the eye is meant to track |
| sky | the procedural dome, **not** the HDRI | a photographed sky carries a huge range, and the exposure needed to hold its highlights (0.45) pushes everything else to the bottom of the curve where there is no colour left |
| ambient | hemisphere at 0.55, sky-blue over warm | in the photoreal balance this was 0 and the environment map did the fill; here it is what makes an unlit face a *colour* rather than an absence of one |
| grade | lift → saturation → contrast, after tone mapping | nothing on screen is ever actually black; the darkest thing is a saturated blue-violet |

The grade runs on **every** quality tier, including the cheapest — it is one
full-screen pass with no extra texture reads, and it carries most of the art
direction, so a phone should not get a different-looking game.

`npm run look` renders four views through the game's own camera, which is the
only honest way to judge any of the above.

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
