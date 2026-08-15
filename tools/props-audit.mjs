/**
 * Is every prop on the hill actually standing on it, the right way up, the
 * right size?
 *
 *   npm run check:props
 *
 * ── why this exists ──
 *
 * Twenty-three electricity poles stood on this map for the life of the
 * project as two-metre heaps of transformers and nails lying in the dirt with
 * no shaft under them. Every check in the suite passed the whole time, and
 * they were all right to: the heaps were drawn, instanced, lit, shadowed,
 * collided with, inside the triangle budget, and standing at the correct
 * ground height. The only thing wrong with them was that a power pole does
 * not look like that, and nothing in the suite knew what a power pole looks
 * like. They were found by eye, in a screenshot taken for an unrelated
 * reason, months in.
 *
 * A check cannot know what a pole looks like either. What it can know is
 * three things that are true of every prop regardless of what it depicts:
 *
 *   COLLAPSED  two different named parts of one prop placed on exactly the
 *              same point. That is an assembly put down a part at a time
 *              with each part's offset thrown away — the pole bug, exactly.
 *              Exact equality, not proximity: the manhole cover's frame and
 *              lid are deliberately a centimetre apart.
 *
 *   BURIED     the prop's base sits below the floor under it. A bin sunk to
 *              its rim, a ladder buried to half its length.
 *
 *   FLOATING   its base sits above the floor, with nothing under it.
 *
 * Buried and floating both allow slack, because plenty of props are hung on
 * walls or stood on roofs on purpose and the floor beneath them is a long way
 * down. So the ground test only judges props whose own placement said they
 * were standing on something.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

const out = await page.evaluate(async () => {
  const g = window.__game;
  const THREE = await import('three');
  g.selected.operator = 'kite';
  g.settings.intro = false;
  g.startRun();
  g._tick(1 / 60);

  const res = { collapsed: g.props?.collapsed ?? [], props: [], ground: [] };

  /* Props whose whole job is to hang off a facade rather than stand on it. */
  const WALL_MOUNTED = new Set([
    'exterior_aircon_unit', 'utility_box_01', 'utility_box_02',
    'rollershutter_door', 'rollershutter_window_01', 'rollershutter_window_03',
    'modular_electric_cables', 'modular_metal_gutter', 'modular_pipes',
    'modular_fire_escape',
  ]);

  /*
   * Rendered extent per prop id, gathered off the InstancedMeshes rather than
   * off the source models, because the whole point is to catch a prop that
   * came out of placement a different shape from the one it went in as.
   *
   * One placement becomes several InstancedMeshes — one per material after
   * the merge, and one per named part for an assembly — so they have to be
   * gathered back together before anything can be measured. Instance *index*
   * does that exactly: every chunk of a prop is built from the same list of
   * placement matrices in the same order, so index i is the same object in
   * all of them.
   *
   * Grouping by proximity instead, which is what this did first, splits a
   * palm into two: the trunk lands one cluster and the frond crown another,
   * because a crown's bounding box centre is metres from the trunk. The crown
   * cluster then has no trunk in it, sits two metres above the ground by
   * definition, and gets reported as a floating tree.
   */
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  const spots = new Map();     // prop id → index → { box, feet[] }

  for (const inst of g.props.root.children) {
    if (!inst.isInstancedMesh) continue;
    const key = inst.name.replace(/^prop:/, '');
    const id = key.split('#')[0];
    if (!inst.geometry.boundingBox) inst.geometry.computeBoundingBox();
    const gb = inst.geometry.boundingBox;
    if (!gb) continue;
    let byIndex = spots.get(id);
    if (!byIndex) spots.set(id, (byIndex = new Map()));
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, m);
      box.copy(gb).applyMatrix4(m);
      if (box.isEmpty()) continue;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const s = byIndex.get(i);
      if (s) { s.box.union(box); s.feet.push({ cx, cz, y: box.min.y }); } else {
        byIndex.set(i, { x: cx, z: cz, box: box.clone(), feet: [{ cx, cz, y: box.min.y }] });
      }
    }
  }
  for (const [id, byIndex] of spots) spots.set(id, [...byIndex.values()]);

  /*
   * Where the thing touches down, which is not where its bounding box is
   * centred. A pole's box is centred on its crossarms, up to a metre off the
   * shaft, and sampling the floor there asks what is under the wires rather
   * than what is under the pole — three poles standing on perfectly good
   * ledges came back as floating five metres because of it.
   *
   * So the sampling point is the footprint of only those parts that reach
   * within half a metre of the assembly's lowest point.
   */
  for (const list of spots.values()) {
    for (const s of list) {
      const low = s.box.min.y;
      const onFloor = s.feet.filter((f) => f.y - low < 0.5);
      if (!onFloor.length) continue;
      s.x = onFloor.reduce((a, f) => a + f.cx, 0) / onFloor.length;
      s.z = onFloor.reduce((a, f) => a + f.cz, 0) / onFloor.length;
    }
  }

  for (const [id, list] of spots) {
    let minH = Infinity, maxH = -Infinity, sum = 0;
    for (const s of list) {
      const h = s.box.max.y - s.box.min.y;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      sum += h;
    }
    res.props.push({
      id, spots: list.length,
      minH: +minH.toFixed(2), maxH: +maxH.toFixed(2), avgH: +(sum / list.length).toFixed(2),
    });

    /*
     * ── what is underneath it ──
     *
     * `groundHeight(x, z, maxY, r)` returns the top of the highest thing whose
     * top is at or below `maxY`. That ceiling is the whole trick here, because
     * a prop cannot be asked what it is standing on by querying from above:
     * the query hits the prop's own geometry. Asking from the sky, a house
     * reports its own roof as its floor and looks buried by its full height —
     * which is exactly the 495 false positives the first draft of this check
     * produced.
     *
     * Ceiling of base + 0.6 instead:
     *   · the prop's own solid box (base .. base + 0.9) is above it, excluded
     *   · its own roof is far above it, excluded
     *   · the floor it stands on is at the base, found
     *   · a floor it is bedded a few centimetres into is found, and reads as
     *     bedded rather than as anything wrong
     *
     * A building piece whose geometry runs metres below the terrace it fronts
     * finds nothing under that ceiling at all and drops out — correctly, since
     * "is this resting on the floor" is not a question about a building.
     */
    /*
     * Architecture is out of scope for the ground test.
     *
     * A slums-kit piece is not a thing standing on a floor; it is a course in
     * a wall, a balcony hung off one, a storey stacked on the storey below.
     * Its base is legitimately anywhere, and the only honest reading of "is
     * it in the right place" for a building piece is whether the house it
     * belongs to is well-formed — which is the map check's job, not this one.
     * The 79 upper-storey pieces this used to flag were all correct.
     *
     * Free-standing props are the opposite: every one of them was placed by
     * code that asked the world how high the floor was, so a floor is exactly
     * what should be under them.
     */
    const BED = 0.6;
    if (/^(slums|city|level):/.test(id) || id === 'level') continue;
    /*
     * And neither is anything bolted to a wall. An air conditioner two and a
     * half metres up a facade is not floating; it is an air conditioner.
     */
    if (WALL_MOUNTED.has(id)) continue;
    for (const s of list) {
      const under = g.world.collision.groundHeight(s.x, s.z, s.box.min.y + BED, 0.3);
      if (under == null || under < -5.5) continue;   // over the void, or a foundation
      res.ground.push({ id, x: +s.x.toFixed(1), z: +s.z.toFixed(1),
        base: +s.box.min.y.toFixed(2), floor: +under.toFixed(2),
        gap: +(s.box.min.y - under).toFixed(2) });
    }
  }
  /*
   * ── drawn at the size it was authored ──
   *
   * The check that would have caught the quantization bug, which drew manhole
   * covers four times too big for the life of the project without a single
   * assertion noticing: measure one placed instance of every prop and compare
   * it against the same node measured in the source model.
   *
   * Height only. A placement carries a yaw, and an axis-aligned box around a
   * rotated prop grows by up to 40% in x and z — so width would fail every
   * prop that is not square. Yaw is about Y, so height is untouched by it and
   * is the one axis where authored and drawn are directly comparable.
   *
   * Every material chunk of one placement is unioned first. Merging by
   * material means a car is several InstancedMeshes sharing one instance
   * index, and measuring the first chunk alone reports the size of a door.
   */
  const drawn = new Map();     // "id#part" → Box3 of instance 0, all materials
  for (const inst of g.props.root.children) {
    if (!inst.isInstancedMesh || !inst.count) continue;
    const key = inst.name.replace(/^prop:/, '');
    if (!inst.geometry.boundingBox) inst.geometry.computeBoundingBox();
    if (!inst.geometry.boundingBox) continue;
    inst.getMatrixAt(0, m);
    box.copy(inst.geometry.boundingBox).applyMatrix4(m);
    if (box.isEmpty()) continue;
    const prev = drawn.get(key);
    if (prev) prev.union(box); else drawn.set(key, box.clone());
  }
  res.sizes = [];
  for (const [key, b] of drawn) {
    const [id, part] = key.split('#');
    const root = g.assets.props.get(id);
    const node = root && (part ? root.getObjectByName(part) : root);
    if (!node) continue;                       // cars and weapons live elsewhere
    node.updateMatrixWorld(true);
    const src = new THREE.Box3().setFromObject(node);
    if (src.isEmpty()) continue;
    const authored = src.max.y - src.min.y;
    const height = b.max.y - b.min.y;
    if (authored < 0.02) continue;             // too thin to compare meaningfully
    res.sizes.push({ key, authored: +authored.toFixed(3), height: +height.toFixed(3),
      ratio: +(height / authored).toFixed(3) });
  }
  res.sizes.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));

  res.props.sort((a, b) => b.spots - a.spots);
  return res;
});
await browser.close();

let bad = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? ' ✓' : ' ✗'} ${label}${extra ? '  ' + extra : ''}`);
};

console.log('\n── what is standing on the hill ──');
console.log('  prop                                spots   height (min/avg/max)');
for (const p of out.props) {
  console.log(`  ${p.id.padEnd(34)} ${String(p.spots).padStart(5)}   ` +
    `${String(p.minH).padStart(6)} ${String(p.avgH).padStart(6)} ${String(p.maxH).padStart(6)}`);
}

console.log('\n── drawn at the size it was authored ──');
const OFF = 0.08;
const wrong = (out.sizes ?? []).filter((s) => Math.abs(s.ratio - 1) > OFF);
for (const s of wrong.slice(0, 14)) {
  console.log(`   ${s.key.padEnd(46)} authored ${String(s.authored).padStart(6)} m, ` +
    `drawn ${String(s.height).padStart(6)} m  (×${s.ratio})`);
}
ok('every prop is drawn the height it was modelled', wrong.length === 0,
  `${(out.sizes ?? []).length - wrong.length} of ${(out.sizes ?? []).length} within ${OFF * 100}%`);

console.log('\n── collapsed assemblies ──');
for (const c of out.collapsed) {
  console.log(`   ${c.id}: ${c.parts} parts share one point, at ${c.spots} spot(s)`);
}
ok('no prop has two parts stacked on the same point',
  out.collapsed.length === 0,
  out.collapsed.length ? `${out.collapsed.map((c) => c.id).join(', ')}` : 'checked every placement');

/*
 * Only floating is asserted, and the slack is wide.
 *
 * A prop's spot is its footprint centre, the floor under it is sampled at one
 * point, and the hill is a slope — so a bin on a ramp reads as off the ground
 * by the rise across its own width. Plenty of props are also stood on roofs,
 * hung on walls, or set on top of other props on purpose. What none of that
 * excuses is a prop a couple of metres clear of everything, which is what the
 * failure looks like when a placement's ground query and its geometry
 * disagree.
 */
const FLOATING = 1.2;
const flying = out.ground.filter((r) => r.gap > FLOATING);
const bedded = out.ground.filter((r) => r.gap < -0.05);

console.log('\n── on the ground ──');
console.log(`  ${out.ground.length} placements have a floor under them; ` +
  `${bedded.length} sit bedded into it`);
for (const r of flying.slice(0, 12)) {
  console.log(`   ${r.id} at (${r.x}, ${r.z}): base ${r.base}, floor ${r.floor}, ` +
    `floating ${r.gap} m`);
}
ok(`nothing floats more than ${FLOATING} m clear of the floor under it`,
  flying.length === 0, flying.length ? `${flying.length} placements` : '');

console.log(bad ? `\n${bad} failure(s)` : '\nthe dressing is sound');
process.exit(bad ? 1 : 0);
