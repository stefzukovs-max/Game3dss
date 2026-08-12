/**
 * What the built level actually costs, and what is in it.
 *
 *   npm run budget
 *
 * Draw calls, triangles and instance counts, broken down by the prefix on each
 * mesh's name — `level:` for the batched map geometry, `prop:` for everything
 * the dressing pass placed. Written when the slum kit went in: a placement pass
 * that samples the map and rejects most candidates gives no indication from a
 * screenshot of whether it placed forty pieces or four hundred, and tuning the
 * density by eye against a software renderer is guesswork either way.
 *
 * Triangles are counted per instance, because that is what the GPU draws.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 180000 });

const out = await page.evaluate(() => {
  const g = window.__game;
  const groups = new Map();
  let draws = 0, tris = 0, instances = 0;

  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.count ?? 1;
    const t = ((o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3) * n;
    draws++; tris += t; instances += n;
    // level:concrete → level · prop:slums:C5 → prop:slums · car:police-hero → car
    const bits = (o.name || 'other').split(':');
    const key = bits.length > 2 ? bits.slice(0, 2).join(':') : bits[0];
    const e = groups.get(key) ?? { draws: 0, tris: 0, instances: 0 };
    e.draws++; e.tris += t; e.instances += n;
    groups.set(key, e);
  });

  const meta = g.world.meta;
  return {
    total: { draws, tris: Math.round(tris), instances },
    collision: g.world.collision.boxes.length,
    houses: meta.houses.length,
    slums: g.props?.slums ?? null,
    rows: [...groups].sort((a, b) => b[1].tris - a[1].tris).map(([k, e]) =>
      `  ${k.padEnd(20)} ${String(e.draws).padStart(4)} draws  ${String(e.instances).padStart(6)} inst  ` +
      `${String(Math.round(e.tris)).padStart(8)} tris`),
  };
});

console.log(`draws ${out.total.draws}   instances ${out.total.instances}   ` +
  `tris ${out.total.tris.toLocaleString()}   collision boxes ${out.collision}   houses ${out.houses}`);
for (const r of out.rows) console.log(r);
if (out.slums) {
  console.log('slums kit  ' + Object.entries(out.slums).map(([k, v]) => `${k} ${v}`).join('   '));
}
await browser.close();
