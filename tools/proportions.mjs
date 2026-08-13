/**
 * What the build table actually produced.
 *
 *   npm run proportions
 *
 * A table of per-bone scale factors is a bundle of guesses until something
 * measures the figure that comes out of it. Three numbers matter:
 *
 *   HEIGHT    the collision capsule, the camera height and every hitbox in
 *             the game are written against a 1.82 m figure. A build that
 *             quietly returns a 1.55 m character leaves the model's head
 *             inside the capsule's chest, and shots at the head miss.
 *
 *   HEADS     height divided by head length. Real people are about 7.5.
 *             Brawl Stars is about 4. This is the number that decides
 *             whether the silhouette reads as stylised or just as short.
 *
 *   REACH     how far the weapon hand sits from the body centre, because the
 *             muzzle is calibrated off it and short arms move it.
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
  const { localFactors, BUILD } = await import('/src/entities/chibi.js');
  const { clone } = await import('three/addons/utils/SkeletonUtils.js');

  const res = { bodies: {}, factors: {} };
  for (const kind of ['body', 'armored', 'crew']) {
    const src = g.assets.models.get(`people:${kind === 'body' ? 'body' : kind}`);
    if (!src) continue;
    const rig = clone(src);
    rig.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(rig);
    const height = box.max.y - box.min.y;
    const at = (n) => {
      const b = rig.getObjectByName(n);
      return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld) : null;
    };
    const head = at('Head'), hand = at('hand_r'), pelvis = at('pelvis'), foot = at('foot_l');
    const headLen = head ? box.max.y - head.y : null;
    res.bodies[kind] = {
      height: +height.toFixed(3),
      headLen: headLen ? +headLen.toFixed(3) : null,
      heads: headLen ? +(height / headLen).toFixed(2) : null,
      hipY: pelvis ? +pelvis.y.toFixed(3) : null,
      footY: foot ? +foot.y.toFixed(3) : null,
      reach: hand && pelvis ? +hand.distanceTo(pelvis).toFixed(3) : null,
      width: +(box.max.x - box.min.x).toFixed(3),
    };
  }

  const base = g.assets.models.get('people:body');
  if (base) {
    const { MAX_EXTREMITY_LOCAL } = await import('/src/entities/chibi.js');
    res.maxExtremity = MAX_EXTREMITY_LOCAL;
    const { local, world } = localFactors(base, BUILD);
    res.extremities = {};
    for (const [k, v] of local) {
      if (/^(hand|foot|ball)_/.test(k)) res.extremities[k] = +v.toFixed(3);
    }
    for (const [k, v] of world) {
      if (/_\d\d_/.test(k)) continue;   // fingers inherit; not worth printing 45 of them
      res.factors[k] = { world: +v.toFixed(3), local: +local.get(k).toFixed(3) };
    }
  }
  return res;
});
await browser.close();

console.log('\n── the figure ──');
console.log('  body        height   head    heads   hip     reach   width');
for (const [k, b] of Object.entries(out.bodies)) {
  console.log(`  ${k.padEnd(11)} ${String(b.height).padEnd(8)} ${String(b.headLen).padEnd(7)} ` +
    `${String(b.heads).padEnd(7)} ${String(b.hipY).padEnd(7)} ${String(b.reach).padEnd(7)} ${b.width}`);
}

console.log('\n── per bone ──');
for (const [k, f] of Object.entries(out.factors)) {
  console.log(`  ${k.padEnd(12)} world ${String(f.world).padEnd(6)} local ${f.local}`);
}

/*
 * Targets. Height has to stay near the 1.82 m the collision capsule assumes;
 * the heads ratio has to come down far enough to read as stylised at the
 * distance the game is actually played at.
 */
let bad = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? ' ✓' : ' ✗'} ${label}${extra ? '  ' + extra : ''}`);
};
console.log('\n── against the capsule ──');
for (const [k, b] of Object.entries(out.bodies)) {
  ok(`${k} still fits a 1.82 m capsule`, Math.abs(b.height - 1.82) < 0.09,
    `${b.height} m`);
  ok(`${k} reads as stylised`, b.heads != null && b.heads < 5.2, `${b.heads} heads`);
}

/*
 * The extremity ceiling. See the long note in chibi.js: a large local scale
 * on a hand or a foot amplifies the bind-pose residual left by the re-bind
 * tool, and the police body comes apart. This is the assertion that stops
 * someone raising `hand` in the build table and shipping it, because on the
 * base body and the crew it looks fine.
 */
console.log('\n── the extremity ceiling ──');
const worst = Object.entries(out.extremities || {})
  .sort((a, b) => b[1] - a[1])[0];
ok(`no hand or foot scales past ${out.maxExtremity} locally`,
  worst && worst[1] <= out.maxExtremity,
  worst ? `worst is ${worst[0]} at ${worst[1]}` : 'none measured');
console.log(bad ? `\n${bad} failure(s)` : '\nthe build holds');
process.exit(bad ? 1 : 0);
