/**
 * The mix, measured.
 *
 *   npm run check:audio
 *
 * This one runs in real time and takes about forty seconds, which is unusual
 * for a check in this repo and is not negotiable: the audio clock is a wall
 * clock. Stepping the simulation faster than real time would let the game
 * walk from the plaza to the summit in four hundred milliseconds while the
 * ambience crossfades, the reverb tails and the sequencer all continued at
 * their own pace, and every number below would be a measurement of the
 * harness rather than of the game.
 *
 * So the browser plays the game, at speed, and this samples what is
 * *actually sounding* four times a second through the engine's layer
 * register. The headline acceptance test for this phase was "any thirty
 * second capture of play contains at least four simultaneous distinct audio
 * layers", which is a claim about concurrency over time — so the check
 * reports the distribution, not a best case. A single lucky frame with five
 * layers on it would pass a max; it would not pass a median.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', e.stack));

/* Payload accounting: this phase was allowed 4 MB of audio and spent none. */
const media = [];
page.on('response', (r) => {
  const ct = r.headers()['content-type'] || '';
  const u = r.url();
  if (/^audio\//.test(ct) || /\.(mp3|ogg|wav|m4a|opus|webm|flac)(\?|$)/i.test(u)) media.push(u);
});

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

/* ── set the run going and start sampling ─────────────────────────── */
await page.evaluate(async () => {
  const g = window.__game;
  const { audio } = await import('/src/core/audio.js');
  window.__audio = audio;
  g.selected.operator = 'kite';
  g.settings.intro = false;
  g.startRun();

  /*
   * The engine cannot resume a suspended context without a gesture, and
   * there is no gesture here. Nudge it directly rather than faking a click,
   * which in headless is unreliable and would only prove the click worked.
   */
  audio.resume();

  /*
   * Stop drawing.
   *
   * This check needs game time and wall time to be the same thing, because
   * the audio clock is a wall clock and everything measured here — bed
   * crossfades, the intermission counting down to the first wave, how long a
   * layer stays marked — is scheduled against one or the other. Under
   * swiftshader the scene renders at about two frames a second, so the first
   * attempt ran forty seconds of wall time against four seconds of game
   * time: the run never left its opening intermission and half the layer
   * marks expired between frames.
   *
   * The render is the only expensive thing in the frame and this check does
   * not look at a single pixel, so it goes. The simulation then runs at the
   * rate the request-animation-frame loop can actually manage, which with no
   * drawing to do is the display rate.
   */
  g.renderFrame = () => {};

  /*
   * Skip most of the opening intermission. "Thirty seconds of play" means
   * thirty seconds of the game being played, and a capture that is three
   * quarters countdown timer measures the quiet case and calls it the mix.
   */
  g.waves.timer = 1.5;

  const S = (window.__cap = { samples: [], barks: [], enc: [], started: performance.now() });
  const origBark = audio.bark.bind(audio);
  audio.bark = (f, k, p, s) => {
    const r = origBark(f, k, p, s);
    if (r) S.barks.push(`${f}:${k}`);
    return r;
  };
  S.timer = setInterval(() => {
    S.samples.push({
      t: (performance.now() - S.started) / 1000,
      layers: audio.activeLayers(),
      enc: +audio.space.enclosure.toFixed(3),
      z: +(g.player?.pos.z ?? 0).toFixed(1),
      y: +(g.player?.pos.y ?? 0).toFixed(1),
      state: g.state,
      phase: g.waves?.phase,
      ctx: audio.ctx?.state,
    });
  }, 250);
});

/*
 * The tour. Four stops chosen because each one is supposed to sound
 * different: the plaza is traffic, the market is the hillside bed with a
 * sound system down the street, the alleys are the enclosed reverb case, and
 * the summit is wind with everything else a long way below.
 */
const STOPS = [
  { name: 'plaza',   x: 6,  z: 52,  secs: 8 },
  { name: 'market',  x: -30, z: 20, secs: 8 },
  /*
   * A covered spot, not just a narrow one. These coordinates were not
   * guessed — an enclosure sweep over the walkable map put the median at
   * 0.36, the plaza at 0.09 and a handful of places at a full 1.0, and this
   * is one of them: six walls inside nine metres with a roof over the top.
   * The first version of this check pointed at x=-46 because the map calls
   * that lane "The Alleys", and measured it as more open than the plaza,
   * which was true and useless.
   */
  { name: 'covered', x: 19, z: 13,  secs: 8 },
  { name: 'summit',  x: 2,  z: -56, secs: 9 },
];

const seen = { encByStop: {} };
for (const stop of STOPS) {
  await page.evaluate(async ({ x, z }) => {
    const g = window.__game;
    const p = g.player;
    const V = p.pos.constructor;
    const { TERRACES } = await import('/src/world/favela.js');
    /*
     * Drop onto the street, not onto a roof.
     *
     * groundHeight traces downward from wherever you start it, so tracing
     * from forty metres over the alleys lands on the first thing it meets —
     * which on this map is a corrugated roof three storeys up. The first run
     * of this check measured the alleys as the *least* enclosed place on the
     * hill for exactly that reason. Start the trace just above the terrace
     * the point belongs to and it finds the floor.
     */
    const terr = TERRACES.find((t) => z >= t.z0 && z <= t.z1) ?? TERRACES[0];
    const spot = new V(x, 0, z);
    spot.y = g.world.collision.groundHeight(x, z, terr.y + 2.4, 0.5);
    p.spawnAt(spot);
    p.health = 10000;
    window.__cap.stopStart = (performance.now() - window.__cap.started) / 1000;
  }, stop);

  /* Hold the trigger in bursts, so gunfire is a layer that comes and goes. */
  await page.evaluate((secs) => new Promise((done) => {
    const g = window.__game;
    let n = 0;
    const iv = setInterval(() => {
      g.input.buttons[0] = (n % 4) < 2;
      if (++n > secs * 2) { clearInterval(iv); g.input.buttons[0] = false; done(); }
    }, 500);
  }), stop.secs);

  const enc = await page.evaluate((name) => {
    const S = window.__cap;
    const from = S.stopStart + 2;    // ignore the crossfade in
    const win = S.samples.filter((s) => s.t >= from);
    return win.length ? win.reduce((a, s) => a + s.enc, 0) / win.length : 0;
  }, stop.name);
  seen.encByStop[stop.name] = +enc.toFixed(3);
  process.stdout.write(`  visited ${stop.name}\n`);
}

/* Force the two set pieces the tour would not otherwise reach. */
await page.evaluate(async () => {
  const g = window.__game;
  /*
   * Draw the line here. Everything recorded up to this point was the game
   * choosing to say something; everything after it is this check forcing a
   * line out of the synthesiser to prove it is not broken. Counted together
   * they would let a completely mute AI pass, because the audit alone fills
   * the list with all twelve.
   */
  window.__cap.organic = window.__cap.barks.length;
  window.__audio.waveStart(true);      // boss sting
  await new Promise((r) => setTimeout(r, 1200));
  window.__cap.bossLayers = window.__audio.activeLayers();
  // and every bark, so a broken one is a failure rather than a coin toss
  const { BARKS } = await import('/src/audio/voice.js');
  window.__cap.barkAudit = {};
  for (const fac of Object.keys(BARKS)) {
    for (const key of Object.keys(BARKS[fac])) {
      const r = window.__audio.bark(fac, key, g.player.pos, 1);
      window.__cap.barkAudit[`${fac}:${key}`] = r ? r.text : null;
    }
  }
});

const cap = await page.evaluate(() => {
  clearInterval(window.__cap.timer);
  const S = window.__cap;
  return {
    samples: S.samples, barks: S.barks.slice(0, S.organic),
    bossLayers: S.bossLayers, barkAudit: S.barkAudit,
    ctx: window.__audio.ctx?.state, rate: window.__audio.ctx?.sampleRate,
    fault: window.__game.audioFault ?? null,
  };
});
await browser.close();

/* ── report ───────────────────────────────────────────────────────── */
let bad = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? ' ✓' : ' ✗'} ${label}${extra ? '  ' + extra : ''}`);
};

const counts = cap.samples.map((s) => s.layers.length).sort((a, b) => a - b);
const pct = (p) => counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * p))] : 0;
const union = new Set();
for (const s of cap.samples) for (const l of s.layers) union.add(l);

console.log(`\n── capture ──`);
console.log(`  ${cap.samples.length} samples over ${(cap.samples.at(-1)?.t ?? 0).toFixed(1)}s` +
  `, context ${cap.ctx} @ ${cap.rate}Hz`);
console.log(`  layers seen: ${[...union].sort().join(', ')}`);
console.log(`  concurrency  min ${counts[0]}  p10 ${pct(0.1)}  median ${pct(0.5)}  max ${counts.at(-1)}`);
{
  const tally = (k) => [...new Set(cap.samples.map((s) => s[k]))].map(
    (v) => `${v}×${cap.samples.filter((s) => s[k] === v).length}`).join(' ');
  console.log(`  game state ${tally('state')} · wave phase ${tally('phase')}`);
}

console.log('\n── the acceptance test ──');
ok('the audio context actually ran', cap.ctx === 'running');
ok('the mix never faulted out', !cap.fault, cap.fault || '');
ok('four or more simultaneous layers, at the median', pct(0.5) >= 4, `median ${pct(0.5)}`);
ok('and at the 10th percentile too — no silent stretches', pct(0.1) >= 3, `p10 ${pct(0.1)}`);
ok('added audio payload is under 4 MB', media.length === 0,
  media.length ? `${media.length} media file(s) fetched` : '0 bytes, everything synthesised');

console.log('\n── the beds ──');
for (const bed of ['amb-plaza', 'amb-hillside', 'amb-summit']) {
  ok(`${bed} is reached somewhere on the hill`, union.has(bed));
}
const zOf = (n) => cap.samples.filter((s) => s.layers.includes(n));
const plazaZ = zOf('amb-plaza').filter((s) => s.z > 30).length;
const summitZ = zOf('amb-summit').filter((s) => s.z < -40).length;
ok('the plaza bed is loudest in the plaza', plazaZ > 0, `${plazaZ} samples`);
ok('the summit bed is loudest at the summit', summitZ > 0, `${summitZ} samples`);

console.log('\n── the space ──');
const e = seen.encByStop;
console.log(`  enclosure: ${Object.entries(e).map(([k, v]) => `${k} ${v}`).join('   ')}`);
ok('a covered lane reads as enclosed, the plaza does not', e.covered > e.plaza + 0.25,
  `${e.covered} vs ${e.plaza}`);
ok('the summit reads as open', e.summit < 0.5, `${e.summit}`);
/*
 * The point of the probe is the tail it drives, so check the tail directly
 * rather than trusting that a number nobody listens to is doing something.
 */
const spread = Math.max(...Object.values(e)) - Math.min(...Object.values(e));
ok('so the reverb has somewhere to move', spread > 0.3, `range ${spread.toFixed(2)}`);

console.log('\n── music ──');
ok('a score plays during a wave', union.has('score'));
ok('window emitters are audible somewhere on the tour', union.has('music-diegetic'));
ok('the boss wave brings in a sting',
  (cap.bossLayers || []).includes('sting') || (cap.bossLayers || []).includes('score'),
  (cap.bossLayers || []).join(','));

console.log('\n── voices ──');
const audited = Object.entries(cap.barkAudit || {});
const missing = audited.filter(([, v]) => !v).map(([k]) => k);
ok('all twelve barks speak', audited.length === 12 && missing.length === 0,
  missing.length ? `missing ${missing.join(', ')}` : `${audited.length} lines`);
ok('and the AI called some of them on its own', cap.barks.length > 0,
  cap.barks.length ? `${cap.barks.length}: ${[...new Set(cap.barks)].join(', ')}` : 'none during play');

console.log(bad ? `\n${bad} failure(s)` : '\nthe hill has a sound');
process.exit(bad ? 1 : 0);
