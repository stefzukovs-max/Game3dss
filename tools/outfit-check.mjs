/**
 * Outfit bench.
 *
 * Cuts every preset in the roster and reports, per garment, how much of the
 * body it actually caught. A garment that comes back at zero triangles is
 * invisible in a screenshot and indistinguishable from one nobody asked for, so
 * the counts are the only way to tell "no sleeves were requested" apart from
 * "the sleeves were requested and the cut missed".
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

const out = await page.evaluate(async () => {
  const { makeOutfit } = await import('/src/entities/character.js');
  const { garmentStats } = await import('/src/entities/outfit.js');
  const { makeRNG } = await import('/src/core/utils.js');

  const src = window.__game.assets?.models.get('people:body');
  if (!src) return ['no character pack loaded — nothing to cut'];

  const log = [];
  let empty = 0;
  for (const [faction, rank] of [['gang', 'grunt'], ['gang', 'elite'], ['police', 'grunt'], ['police', 'elite']]) {
    const seen = new Set();
    for (let s = 1; s <= 40; s++) {
      const o = makeOutfit(faction, rank, makeRNG(s));
      const shape = o.preset.split(':').slice(0, 3).join(':');
      if (seen.has(shape)) continue;
      seen.add(shape);

      const stats = garmentStats(src, o);
      empty += stats.filter((x) => !x.tris).length;
      log.push(`${shape.padEnd(16)} ` +
        stats.map((x) => `${x.name} ${x.tris || 'EMPTY'}`).join(', '));
    }
  }
  log.push(empty ? `${empty} garment(s) cut to nothing` : 'every garment cut something');
  return log;
});

for (const l of out) console.log(l);
await browser.close();
