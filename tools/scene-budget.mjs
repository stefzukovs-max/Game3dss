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

  /*
   * ── what actually gets drawn ──
   *
   * The authoritative numbers come from `renderer.info` after a real render,
   * not from walking the scene graph. The first version of this tool counted
   * every mesh it could find and called that the draw count, which was wrong in
   * both directions and wrong by a lot: it counted 224 pooled effect quads that
   * are `visible = false` and cost nothing, and it counted everything outside
   * the frustum that the renderer culls before it ever issues a call. It
   * reported 587 draws for a scene that draws far fewer.
   *
   * So: point the camera somewhere representative, render, and read the meter.
   */
  g.camera.position.set(-2, 9, 30);
  g.camera.lookAt(0, 6, -14);
  g.camera.fov = 78;
  g.camera.updateProjectionMatrix();
  if (g.skyDome) g.skyDome.position.copy(g.camera.position);
  // `autoReset` is off game-side, so one manual reset covers every pass the
  // post chain makes on the way to the screen
  g.renderer.info.autoReset = false;
  g.renderer.info.reset();
  (g.renderFrame ? g.renderFrame() : g.renderer.render(g.scene, g.camera));
  const r = g.renderer.info.render;
  const drawn = { draws: r.calls, tris: r.triangles };

  /*
   * The inventory is a separate question from the draw count: it is what is
   * loaded and placed, which is what the asset work moves. Both are worth
   * seeing, and conflating them is what hid the problem for so long.
   */
  const groups = new Map();
  let meshes = 0, tris = 0, instances = 0;
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.count ?? 1;
    const t = ((o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3) * n;
    meshes++; tris += t; instances += n;
    // level:concrete → level · prop:slums:C5 → prop:slums · car:police-hero → car
    const bits = (o.name || 'other').split(':');
    const key = bits.length > 2 ? bits.slice(0, 2).join(':') : bits[0];
    const e = groups.get(key) ?? { meshes: 0, tris: 0, instances: 0 };
    e.meshes++; e.tris += t; e.instances += n;
    groups.set(key, e);
  });

  const meta = g.world.meta;
  return {
    drawn,
    total: { meshes, tris: Math.round(tris), instances },
    collision: g.world.collision.boxes.length,
    houses: meta.houses.length,
    slums: g.props?.slums ?? null,
    rows: [...groups].sort((a, b) => b[1].tris - a[1].tris).map(([k, e]) =>
      `  ${k.padEnd(20)} ${String(e.meshes).padStart(4)} meshes ${String(e.instances).padStart(6)} inst  ` +
      `${String(Math.round(e.tris)).padStart(8)} tris`),
  };
});

console.log(`DRAWN   ${out.drawn.draws} draws   ${out.drawn.tris.toLocaleString()} tris` +
  `   (one frame, from the escadão looking uphill)`);
console.log(`LOADED  ${out.total.meshes} meshes   ${out.total.instances} instances   ` +
  `${out.total.tris.toLocaleString()} tris   ${out.collision} collision boxes   ${out.houses} houses\n`);
for (const r of out.rows) console.log(r);
if (out.slums) {
  console.log('slums kit  ' + Object.entries(out.slums).map(([k, v]) => `${k} ${v}`).join('   '));
}
await browser.close();

/*
 * ── the gate ──
 *
 * A report nobody reads is how the scene got to two and a half million
 * triangles without anyone noticing, so this exits non-zero when it is over
 * budget and can be put in front of a commit.
 *
 * The ceilings are what a mid-range phone can hold at 60 fps with room left for
 * the game itself, not what the scene happens to cost today. They are meant to
 * be uncomfortable. `--report` skips the gate for when you only want the
 * breakdown.
 */
const CEILING = { tris: 450_000, draws: 220 };
if (!process.argv.includes('--report')) {
  const over = [];
  if (out.drawn.tris > CEILING.tris) {
    over.push(`triangles drawn ${out.drawn.tris.toLocaleString()} > ${CEILING.tris.toLocaleString()}`);
  }
  if (out.drawn.draws > CEILING.draws) over.push(`draw calls ${out.drawn.draws} > ${CEILING.draws}`);
  if (over.length) {
    console.error('\nOVER BUDGET\n  ' + over.join('\n  ') +
      '\n\nThe breakdown above says where it went. `--report` prints without failing.');
    process.exit(1);
  }
  console.log(`\nwithin budget (${CEILING.tris.toLocaleString()} tris, ${CEILING.draws} draws)`);
}
