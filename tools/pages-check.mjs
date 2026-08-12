/**
 * Static-hosting check.
 *
 * GitHub Pages serves a project site from a subdirectory
 * (`https://user.github.io/<repo>/`), not from the domain root. Anything that
 * loads by absolute path works perfectly on the dev server and 404s there, and
 * the failure lands *inside* the loading screen — the page comes up, the bar
 * sticks, and there is nothing in the UI to say why.
 *
 * So this serves the game from a subdirectory the way Pages will, boots it for
 * real, and fails loudly if any request 404s or the menu never arrives.
 *
 *   node tools/pages-check.mjs [url]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:8099/Game3dss/';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const bad = [];
const errors = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => bad.push(`FAILED ${r.url()} — ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'load' });

let ok = true;
try {
  await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 180000 });
  console.log(' ✓ menu reached');
} catch {
  ok = false;
  console.log(' ✗ menu never appeared — the loading screen stalled');
}

// and it has to actually run, not just render a menu
const ran = await page.evaluate(async () => {
  const g = window.__game;
  if (!g) return 'no game object';
  g.settings.intro = false;
  g.startRun();
  for (let i = 0; i < 120; i++) { g._tick(1 / 60); if (g.state === 'draft') g._closeDraft(); }
  return { state: g.state, assets: !!g.assets?.ready, skinned: !!g.skinned, agents: g.agents.length };
});
console.log(' ·', JSON.stringify(ran));
if (typeof ran === 'string' || !ran.assets) { ok = false; console.log(' ✗ assets did not load'); }
else console.log(' ✓ assets loaded and a run started');

if (bad.length) {
  ok = false;
  console.log(`\n ✗ ${bad.length} failed request(s):`);
  for (const b of bad.slice(0, 20)) console.log('   ', b);
} else console.log(' ✓ every request served');

if (errors.length) {
  ok = false;
  console.log(`\n ✗ ${errors.length} page error(s):`);
  for (const e of errors.slice(0, 10)) console.log('   ', e);
} else console.log(' ✓ no page errors');

await page.screenshot({ path: `${process.env.SHOT_DIR ?? '.'}/pages-check.png`, timeout: 90000 }).catch(()=>{});
await browser.close();
process.exit(ok ? 0 : 1);
