/**
 * Does the skinning hold together when the skeleton moves?
 *
 *   npm run check:skin
 *
 * ── the two things this measures ──
 *
 * TEARS. A skinned triangle whose corners follow bones that move apart gets
 * stretched between them. The police body shipped with a run of vertices
 * across the right arm and thigh bound to `Head`, and with its hands welded to
 * its hips by the model reduction — and every police figure in the game had
 * metre-long pale shards spearing out of it as a result. None of it is visible
 * in the bind pose, which is the only pose anything else in the suite looks at:
 * the mesh is intact, the weights sum to one, the triangle count is fine. It
 * only exists once a clip plays.
 *
 * So the measurement has to be made on a posed figure, and the number that
 * matters is how far a triangle's edge is stretched *beyond what it already
 * was*. A twenty-times stretch of a two-centimetre triangle is invisible; the
 * shards were 1.23 m long and had started out at 0.11 m.
 *
 * ARMS CLEAR OF THE BODY. The standing complaint about these characters, and
 * the one thing a stylised build gets wrong most easily: chibi proportions
 * widen the torso and shorten the limbs, and an arm that used to hang beside
 * the ribs ends up inside them. It is measured as the real thing — the closest
 * approach between vertices that move with the arms and vertices that move
 * with the spine, on the actual skinned surface — rather than as bone angles,
 * because bone angles can look fine while the mesh interpenetrates.
 *
 * Both are checked across the poses the game actually plays, not just idle:
 * an arm tucks into a torso on the aim pose long before it does standing
 * still.
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

const POSES = [
  { name: 'idle', speed: 0, aiming: false, crouching: false, pitch: 0 },
  { name: 'jog', speed: 3.4, aiming: false, crouching: false, pitch: 0 },
  { name: 'sprint', speed: 6.2, aiming: false, crouching: false, pitch: 0 },
  { name: 'aim', speed: 0, aiming: true, crouching: false, pitch: 0 },
  { name: 'aim-move', speed: 3.4, aiming: true, crouching: false, pitch: 0 },
  { name: 'aim-up', speed: 0, aiming: true, crouching: false, pitch: 0.5 },
  { name: 'aim-down', speed: 0, aiming: true, crouching: false, pitch: -0.5 },
  { name: 'crouch', speed: 0, aiming: false, crouching: true, pitch: 0 },
  { name: 'crouch-aim', speed: 0, aiming: true, crouching: true, pitch: 0 },
];

const out = await page.evaluate(async (poses) => {
  const g = window.__game;
  const THREE = await import('three');

  /*
   * The clavicle counts as torso, not as arm.
   *
   * It is a bone in the arm chain but it is not a part of the body that hangs
   * free: the shoulder cap is continuous surface with the chest, and the two
   * are *supposed* to touch. Counting it as arm made the check report a 6 mm
   * "arm inside the torso" on every pose of a model whose arms were fine, and
   * that reading is the shoulder meeting the neck.
   *
   * What the question is really about is the limb below the shoulder.
   */
  const ARM = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
  const TORSO = /^(spine_|pelvis$|neck_|clavicle_)/;

  /** Skin one mesh on the CPU and split its vertices by what drives them. */
  const measure = (mesh) => {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const sI = geo.attributes.skinIndex, sW = geo.attributes.skinWeight;
    const bones = mesh.skeleton.bones;

    const v = new THREE.Vector3();
    const skinned = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      skinned[i * 3] = v.x; skinned[i * 3 + 1] = v.y; skinned[i * 3 + 2] = v.z;
    }

    /* ── tears ── */
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let worst = { grew: 0 };
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const vi = [idx ? idx.getX(t) : t, idx ? idx.getX(t + 1) : t + 1, idx ? idx.getX(t + 2) : t + 2];
      for (let e = 0; e < 3; e++) {
        const i0 = vi[e], i1 = vi[(e + 1) % 3];
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1);
        const was = a.distanceTo(b);
        a.set(skinned[i0 * 3], skinned[i0 * 3 + 1], skinned[i0 * 3 + 2]);
        b.set(skinned[i1 * 3], skinned[i1 * 3 + 1], skinned[i1 * 3 + 2]);
        const now = a.distanceTo(b);
        /*
         * How much longer the edge got, in metres. Absolute, not a ratio: a
         * ratio makes a hair-thin triangle look like the worst thing on the
         * model and a genuine metre-long tear look ordinary.
         */
        if (now - was > worst.grew) worst = { grew: now - was, was: +was.toFixed(3), now: +now.toFixed(3) };
      }
    }

    /* ── arms against the torso ── */
    const group = (i) => {
      let arm = 0, torso = 0;
      for (let k = 0; k < 4; k++) {
        const w = sW.getComponent(i, k);
        if (w <= 0) continue;
        const name = bones[sI.getComponent(i, k)]?.name ?? '';
        if (ARM.test(name)) arm += w; else if (TORSO.test(name)) torso += w;
      }
      return arm > 0.7 ? 'arm' : torso > 0.7 ? 'torso' : null;
    };
    const arms = [], torso = [];
    const step = Math.max(1, Math.floor(pos.count / 1400));
    for (let i = 0; i < pos.count; i += step) {
      const gp = group(i);
      if (gp === 'arm') arms.push(i); else if (gp === 'torso') torso.push(i);
    }
    let gap = Infinity;
    for (const i of arms) {
      const ax = skinned[i * 3], ay = skinned[i * 3 + 1], az = skinned[i * 3 + 2];
      for (const j of torso) {
        const dx = ax - skinned[j * 3], dy = ay - skinned[j * 3 + 1], dz = az - skinned[j * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < gap) gap = d;
      }
    }
    return {
      grew: +worst.grew.toFixed(3), was: worst.was ?? 0, now: worst.now ?? 0,
      gap: arms.length && torso.length ? +Math.sqrt(gap).toFixed(3) : null,
      armVerts: arms.length, torsoVerts: torso.length,
    };
  };

  const res = { repairs: window.__weightRepairs ?? [], bodies: [] };

  for (const faction of ['gang', 'police']) {
    g.selected.faction = faction;
    g.selected.operator = faction === 'gang' ? 'kite' : 'stone';
    g.settings.intro = false;
    g.startRun();
    for (let i = 0; i < 30; i++) g._tick(1 / 60);
    const p = g.player;

    for (const pose of poses) {
      // settle the blend so the pose is the one named, not a transition
      for (let i = 0; i < 30; i++) p.model.update(1 / 30, { ...pose, dead: false });
      p.model.root.updateMatrixWorld(true);
      let worstMesh = null;
      p.model.root.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const m = measure(o);
        if (!worstMesh || m.grew > worstMesh.grew) worstMesh = { mesh: o.name, ...m };
      });
      if (worstMesh) res.bodies.push({ faction, pose: pose.name, ...worstMesh });
    }
  }
  return res;
}, POSES);
await browser.close();

let bad = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? ' ✓' : ' ✗'} ${label}${extra ? '  ' + extra : ''}`);
};

console.log('\n── weights repaired at load ──');
if (!out.repairs.length) console.log('   nothing needed repairing');
for (const r of out.repairs) {
  for (const m of r.meshes) {
    console.log(`   ${r.kind.padEnd(9)} ${m.mesh.padEnd(18)} ` +
      `${String(m.fixed).padStart(4)} vertices re-weighted over ${m.passes} pass(es), ` +
      `${m.cut} bridge triangle(s) cut` +
      (m.worst ? `  — worst: ${m.worst.was} → ${m.worst.now}, ${m.worst.hops} joints apart` : ''));
  }
}

console.log('\n── the surface under load ──');
console.log('  faction  pose         worst edge growth      arm-to-torso gap');
for (const b of out.bodies) {
  console.log(`  ${b.faction.padEnd(8)} ${b.pose.padEnd(12)} ` +
    `${String(b.was).padStart(5)} → ${String(b.now).padEnd(6)} (+${b.grew} m)  ` +
    `${b.gap === null ? '     —' : String(b.gap).padStart(6)} m`);
}

/*
 * ── the thresholds ──
 *
 * TEAR. Before the load-time repair the worst edge on the police body went
 * from 0.11 m to 1.23 m — it grew by 1.12 m. After it, the largest growth
 * anywhere is a few centimetres, which is ordinary skin sliding over a joint.
 * A quarter of a metre sits well clear of both and is the length at which a
 * torn triangle stops being a wrinkle and starts being a shard on screen.
 *
 * GAP. This one asserts less than it looks like it does, on purpose.
 *
 * Arms touch the body. A sleeve joins a shirt at the armpit and a hand hangs
 * against a hip, and those surfaces meet however good the model is — the crew
 * body's arm clears its ribs by 20 mm while the *shirt over it* reads 6.7 mm
 * at the armpit seam, and only the first number is a fact about the arm. An
 * attempt to exclude the armpit by height worked on a hanging arm and reported
 * nothing at all on a raised one, which is a worse check than no check.
 *
 * So the floor is set where contact stops and interpenetration starts. Five
 * millimetres of separation between two sampled surfaces means they are
 * adjacent; zero means one is inside the other. Getting the arms genuinely
 * clear of the ribs is what the table above is for, and it is worth reading:
 * before the shoulder splay every gang pose measured 2 mm, which is a figure
 * with its arms buried in its own chest.
 */
const TEAR = 0.25;
const GAP = 0.005;

console.log('');
const torn = out.bodies.filter((b) => b.grew > TEAR);
for (const b of torn) {
  console.log(`   ${b.faction} ${b.pose}: ${b.mesh} edge ${b.was} → ${b.now} m`);
}
ok(`nothing tears more than ${TEAR} m out of shape in any pose`, torn.length === 0,
  torn.length ? `${torn.length} of ${out.bodies.length} poses` : `worst is +${
    Math.max(...out.bodies.map((b) => b.grew)).toFixed(3)} m`);

const stuck = out.bodies.filter((b) => b.gap !== null && b.gap < GAP);
for (const b of stuck) console.log(`   ${b.faction} ${b.pose}: arm ${b.gap} m from the torso`);
ok('the arms stay outside the body in every pose', stuck.length === 0,
  stuck.length ? `${stuck.length} poses` : `closest is ${
    Math.min(...out.bodies.filter((b) => b.gap !== null).map((b) => b.gap)).toFixed(3)} m`);

console.log(bad ? `\n${bad} failure(s)` : '\nthe skinning holds');
process.exit(bad ? 1 : 0);
