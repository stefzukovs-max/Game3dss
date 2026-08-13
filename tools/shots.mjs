/** Capture menu + HUD + map screenshots for visual review. */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 120000 });
await page.waitForTimeout(1200);

await page.screenshot({ path: `${OUT}/ui-1-menu-gang.png`, timeout: 90000 });

await page.click('.op-list .op-card:nth-child(3)');           // Queen
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ui-2-operator.png`, timeout: 90000 });

await page.click('.ftab[data-f="police"]');
await page.waitForTimeout(400);
await page.click('.op-list .op-card:nth-child(2)');           // Sgt. Stone
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ui-3-police.png`, timeout: 90000 });

await page.click('#btn-howto');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ui-4-settings.png`, timeout: 90000 });
await page.click('#btn-opts-back');
await page.waitForTimeout(200);

// ── start a run as a gangster and let the fight develop ──
await page.evaluate(() => {
  const g = window.__game;
  g.selected.faction = 'gang';
  g.selected.operator = 'boulder';
  window.__game.settings.intro = false;   // harnesses drive the game directly
  g.startRun();
  for (let i = 0; i < 60 * 30; i++) {
    g._tick(1 / 60);
    if (g.state !== 'playing') break;                    // stop at the draft
  }
});
// clear any overlay so we photograph the live HUD, not a menu
await page.evaluate(() => {
  const g = window.__game;
  if (g.state === 'draft') g._closeDraft();
  document.getElementById('overlay').classList.add('gone');
  g.state = 'playing';
  for (let i = 0; i < 120; i++) g._tick(1 / 60);
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/ui-5-hud.png`, timeout: 90000 });

// ── beauty passes over the map ──
const views = [
  ['map-1-plaza', [-2, 9, 62], [-4, 3, 30]],
  ['map-2-escadao', [1, 12, 26], [0, 8, -10]],
  ['map-3-lajes', [-30, 17, -6], [-6, 12, -32]],
  ['map-4-summit', [22, 22, -30], [0, 17, -56]],
  ['map-5-overview', [-96, 78, 66], [0, 8, -18]],
  ['map-6-street', [40, 6, 24], [42, 4, 6]],
  /*
   * Two views for reading the layout rather than admiring it.
   *
   * `plan` looks straight down from above the middle of the hill: the only
   * angle that shows whether the lanes are lanes and the blocks are blocks. A
   * three-quarter overview flatters a map — everything overlaps into a
   * plausible-looking mass — and it is why the hillside read as "organised"
   * from the air while being unreadable to stand in.
   *
   * `lane` stands in the west lane at eye height looking uphill, which is the
   * view a player actually has.
   */
  ['map-7-plan', [0, 132, -6], [0, 0, -6]],
  ['map-8-lane', [-44, 5.2, 20], [-44, 4.2, -30]],
];
for (const [name, pos, look] of views) {
  await page.evaluate(([p, l]) => {
    const g = window.__game;
    g.hud.show(false);
    document.getElementById('overlay').classList.add('gone');
    // park the sim so the third-person camera stops reclaiming the view
    g.state = 'paused';
    g.camera.position.set(p[0], p[1], p[2]);
    g.camera.lookAt(l[0], l[1], l[2]);
    g.camera.fov = 62;
    g.camera.updateProjectionMatrix();
    if (g.skyDome) g.skyDome.position.copy(g.camera.position);
    // Keep the shadow box on what we're looking at, without changing the sun's
    // direction — that comes from the HDRI now, and overriding it here would
    // light the scene from somewhere the sky does not agree with.
    const dir = g.sun.position.clone().sub(g.sun.target.position).normalize();
    g.sun.target.position.set(l[0], l[1], l[2]);
    g.sun.position.set(l[0], l[1], l[2]).addScaledVector(dir, 90);
    g.sun.target.updateMatrixWorld();
    (g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera));
  }, [pos, look]);
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const g = window.__game;
    if (g.skyDome) g.skyDome.position.copy(g.camera.position);
    (g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera));
  });
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 90000 });
}

console.log('shots written to', OUT);
await browser.close();
