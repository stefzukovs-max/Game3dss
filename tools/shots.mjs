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

await page.screenshot({ path: `${OUT}/ui-1-menu-gang.png` });

await page.click('.op-list .op-card:nth-child(3)');           // Queen
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ui-2-operator.png` });

await page.click('.ftab[data-f="police"]');
await page.waitForTimeout(400);
await page.click('.op-list .op-card:nth-child(2)');           // Sgt. Stone
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ui-3-police.png` });

await page.click('#btn-howto');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ui-4-settings.png` });
await page.click('#btn-opts-back');
await page.waitForTimeout(200);

// ── start a run as a gangster and let the fight develop ──
await page.evaluate(() => {
  const g = window.__game;
  g.selected.faction = 'gang';
  g.selected.operator = 'boulder';
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
await page.screenshot({ path: `${OUT}/ui-5-hud.png` });

// ── beauty passes over the map ──
const views = [
  ['map-1-plaza', [-2, 9, 62], [-4, 3, 30]],
  ['map-2-escadao', [1, 12, 26], [0, 8, -10]],
  ['map-3-lajes', [-30, 17, -6], [-6, 12, -32]],
  ['map-4-summit', [22, 22, -30], [0, 17, -56]],
  ['map-5-overview', [-96, 78, 66], [0, 8, -18]],
  ['map-6-street', [40, 6, 24], [42, 4, 6]],
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
    g.world.sky.position.copy(g.camera.position);
    // keep the sun shadow box on what we're looking at
    g.sun.target.position.set(l[0], l[1], l[2]);
    g.sun.position.set(l[0] - 55, l[1] + 70, l[2] + 45);
    g.sun.target.updateMatrixWorld();
    g.renderer.render(g.scene, g.camera);
  }, [pos, look]);
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const g = window.__game;
    g.world.sky.position.copy(g.camera.position);
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

console.log('shots written to', OUT);
await browser.close();
