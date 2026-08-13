# Sound

Escadão ships **no audio files**. Every sound in it — the guns, the wind, the
dogs, the baile funk coming out of a window on the third terrace, the voices —
is built out of oscillators and noise at the moment it is needed.

That is a constraint with a real cost and a real payoff, and both are worth
stating plainly.

**The cost.** You cannot synthesise a convincing human voice, a recorded
gunshot has a density of detail that no filter chain matches, and there is no
way to synthesise a melody somebody wrote. Nothing here will be mistaken for a
recording.

**The payoff.** Zero download, zero decode, zero load time, and — because
everything is generated rather than played back — no loop. The music does not
repeat, the recoil of the mix responds to where you are standing, and the
reverb on a gunshot is computed from the walls actually around the shooter
rather than picked from a list of three presets. A four-megabyte audio budget
buys about ninety seconds of stereo music. This buys all of it.

---

## The mix

```
emitters ─┬─► sfx   ─┐
          ├─► amb   ─┤
          ├─► music ─┼─► master ─► compressor ─► out
          └─► voice ─┘
               │
               └─ sends ─► alleyVerb / openVerb ─► master
```

Four named buses so ducking a category is one gain ramp. Two convolution
reverbs live permanently on sends, because swapping a convolver's impulse
response per shot costs more than running both and crossfading. Their impulse
responses are grown, not recorded: noise under an exponential decay, tilted by
a one-pole filter so the long tail comes back darker than the short one.

| send | length | tone | what it is |
|---|---|---|---|
| `alley` | 0.34 s | bright | two close walls and a lid |
| `open` | 1.7 s | dark | the hill below you, answering |

## Where the reverb comes from

Eight times a second the game fires six rays outward from the player and one
straight up, and turns the result into a single number between 0 and 1.
Everything that makes a noise reads it.

Measured over the walkable map: **median 0.36, the plaza 0.09, the tightest
covered lanes 1.0.** So a shot in the plaza rolls away for over a second and
comes back dark; the same shot under a roof between two blocks is a hard
bright slap that is gone in a third of a second. This is not a switch between
two presets — it is continuous, and walking out of an alley crossfades it.

## Guns

Three layers per shot:

1. **the action** — bolt, spring, brass. Close-range detail only; it fades out
   by 26 m, because at thirty metres you hear the report and nothing else.
2. **the body** — a noise crack swept down through a bandpass, plus a
   triangle-wave thump for the charge.
3. **the tail** — sent to both reverbs, mixed by the enclosure number above.

Suppressed fire keeps a tail but loses the slap and most of the body.

## Music

Two kinds, deliberately the same engine.

**Diegetic.** Three window emitters on the map — the dancehall, the bandstand,
an upstairs window in the alleys — each running its own baile funk sequencer at
its own tempo and key. Attenuated by distance, lowpassed by distance, and
lowpassed *again* when a wall is in the way, so the party you can hear round
the corner sounds like it is round the corner.

The beat underneath is the **tamborzão**, the pattern nearly all funk carioca
has been built on since the late nineties. Its signature is the surdo landing
on the tresillo — steps 1, 4, 7, 11, 13 of sixteen — rather than on the beat,
so it leans forward and never quite resolves. A sequencer rather than a loop,
so it never audibly repeats and can be re-voiced live.

**The score.** The same sequencer at half tempo, an octave down, with the riff
stripped out and left to grind: recognisably the hill's own music with the fun
taken out of it. It comes in when a wave starts, ducks the radios under it, and
its intensity is driven by how close the nearest hostile is rather than by a
timer. Between contacts it thins to a drone and the neighbourhood comes back.

Stings: a rising three-note figure on a normal wave, three wide low hits on a
heavy push, and a four-note fall on defeat — the wave-clear cue is the only
thing in the game that resolves upward.

## Voices

Formant synthesis, not text-to-speech. A sawtooth glottal source at a shouted
pitch through three parallel bandpass filters tuned to a vowel's formants,
with a consonant burst in front of each syllable and a falling contour across
the line. It is recognisably a human shouting from thirty metres and says
nothing; the subtitle carries the words. Animal Crossing and The Sims both did
this, for the same reason.

Two throats. The **battalion** is lower, tighter, and squeezed through a
300–3400 Hz telephone band with a squelch either side — they are on a net. The
**crew** is higher, louder and wide open — they are shouting across rooftops.

Six lines each: contact, reloading, grenade, pushing, man down, clear. All of
them funnel through one rate limiter — one line at a time across the whole map,
one per speaker per six seconds — because a bark is only information if it is
rare. Subtitles appear only for your own side and only within 34 m; reading the
enemy's radio traffic through a wall would be an aimbot with captions.

## Ambience

Three beds, crossfaded by position on the slope, overlapping deliberately so no
terrace boundary is audible as a switch:

| bed | continuous | intermittent |
|---|---|---|
| plaza | road rumble, city hiss, a generator | horns, a two-tone siren, a moped |
| hillside | televisions, a water-tank drip | dogs, canned laughter, buckets |
| summit | wind with gusts, the city far below | loose zinc roofing, a long swell |

Intermittent events are placed at a random bearing and distance around the
listener each time rather than at fixed points, because a dog that is always in
the same doorway becomes furniture and you stop hearing it.

**Fireworks.** One goes up at the top of every wave. This is not decoration: in
Rio, lookouts set off rojões when police enter the community, and everyone on
the hill knows what it means before a radio call goes out. It makes the game's
wave alarm diegetic — the player hears the hill warning itself.

---

## Verification

```bash
npm run check:audio
```

The only check in this repo that runs in real time, and takes about forty
seconds. That is not laziness: the audio clock *is* a wall clock, and stepping
the simulation faster than real time would measure the harness rather than the
game. It disables rendering so that game time and wall time agree — under
swiftshader the scene draws at about two frames a second, and the first version
of this check ran forty seconds of wall time against four seconds of game time,
never left its opening intermission, and reported a mix that did not exist.

It walks the player to four places chosen because each should sound different,
holds the trigger in bursts, and samples what is *actually sounding* four times
a second through the engine's own layer register.

### Last run

| | |
|---|---|
| samples | 144 over 36.0 s, context running @ 44100 Hz |
| layers seen | `amb-plaza` `amb-hillside` `amb-summit` `ambient-event` `gunfire` `impacts` `music-diegetic` `score` `score-drone` `sting` `voice` |
| **concurrency** | min 0 · **p10 3** · **median 6** · max 9 |
| enclosure | plaza 0.27 · market 0.36 · covered lane **0.97** · summit 0.26 |
| added payload | **0 bytes** |

The phase's acceptance test was "any 30-second capture of play contains at
least four simultaneous distinct audio layers, under 4 MB added". The check
reports the distribution rather than a best case, because a single lucky frame
with five layers passes a maximum and fails a median.

## What this cannot tell you

Whether it sounds *good*. Layer count, enclosure spread and payload are all
measurable; mix quality is not, and nothing in this repo has heard itself. The
numbers above say the parts are running, positioned, and responding to the
world — they say nothing about whether the funk is in tune with the score, or
whether the police voice reads as a radio or as a kazoo. That needs ears.
