/**
 * Does the character rig actually work?
 *
 *   npm run check:rig
 *
 * ── why this is the first check now ──
 *
 * The previous character setup was a body from one pack re-bound onto a
 * skeleton from another by a Blender script, and every visual defect in the
 * game came out of that seam: vertices weighted to bones on the far side of
 * the body, hands welded to hips by the reduction, arm scale tracks that
 * inflated a shoulder three and a half times. Each was found by eye, months
 * apart, and each needed a runtime repair to paper over.
 *
 * The replacement removes the seam rather than patching it. Quaternius'
 * Universal Animation Library ships the skeleton, the clips and a rigged
 * Mannequin in a single CC0 file, so the mesh and the animation are bound
 * together by the person who made them. There is nothing to retarget and
 * nothing to re-bind.
 *
 * This check exists to keep it that way. It loads the file the game loads and
 * asserts the four things that were silently untrue of the old setup:
 *
 *   · the mesh is skinned to the skeleton the clips address
 *   · every clip drives bones that exist, so nothing is silently inert
 *   · no clip animates bone *scale* away from 1 — the fault that flung the
 *     weapon arm over the character's head
 *   · the figure is the height the collision capsule assumes, measured with
 *     skinning applied rather than off a bind-pose bounding box
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

/*
 * A bare page on the dev server's origin, not the game. The game spends a
 * couple of minutes loading everything it owns before it will answer a
 * question, and none of that is needed to ask whether one file is well formed.
 */
await page.goto('http://localhost:8080/tools/blank.html', { waitUntil: 'load' });

const out = await page.evaluate(async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

  const gltf = await new Promise((res, rej) =>
    new GLTFLoader().load('/assets/models/rig/universal.glb', res, undefined, rej));

  const root = gltf.scene;
  root.updateMatrixWorld(true);

  let mesh = null;
  root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) return { error: 'no skinned mesh in the file' };

  const bones = mesh.skeleton.bones;
  const names = new Set(bones.map((b) => b.name));

  /* every track's target bone, and any that address nothing */
  const missing = new Set();
  let scaleTracks = 0, worstScale = 1, worstWhere = null;
  for (const clip of gltf.animations) {
    for (const track of clip.tracks) {
      const bone = track.name.split('.')[0];
      if (!names.has(bone)) missing.add(`${clip.name}:${bone}`);
      if (!track.name.endsWith('.scale')) continue;
      scaleTracks++;
      for (let i = 0; i < track.values.length; i++) {
        const d = Math.abs(track.values[i] - 1);
        if (d > Math.abs(worstScale - 1)) {
          worstScale = track.values[i];
          worstWhere = `${clip.name} ${track.name}`;
        }
      }
    }
  }

  /*
   * Height with skinning applied. A bounding box over a SkinnedMesh's geometry
   * reads the bind-space vertices and never goes near a bone, which is how a
   * rig running at 45% of its intended size survived this project once before.
   */
  const mixer = new THREE.AnimationMixer(root);
  const idle = gltf.animations.find((a) => a.name === 'Idle_Loop') ?? gltf.animations[0];
  mixer.clipAction(idle).play();
  mixer.update(0.4);
  root.updateMatrixWorld(true);

  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  const step = Math.max(1, Math.floor(pos.count / 3000));
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    mesh.localToWorld(v);
    if (v.y < lo) lo = v.y;
    if (v.y > hi) hi = v.y;
  }

  /*
   * And that a clip actually moves the figure, rather than loading inert.
   *
   * `DEF-handR`, not `DEF-hand.R`. The file names it with a dot, Rigify style,
   * and GLTFLoader strips it — a dot separates the object from the property in
   * an animation track name, so it cannot survive in one. Anything looking a
   * bone up by the name it has in Blender finds nothing and silently does
   * nothing, which is worth a line of comment given how much of this project's
   * history is exactly that failure.
   */
  const hand = root.getObjectByName('DEF-handR');
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  if (hand) hand.getWorldPosition(before);
  mixer.update(0.5);
  root.updateMatrixWorld(true);
  if (hand) hand.getWorldPosition(after);

  let tris = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });

  return {
    bones: bones.length,
    clips: gltf.animations.length,
    clipNames: gltf.animations.map((a) => a.name),
    missing: [...missing],
    scaleTracks,
    worstScale: +worstScale.toFixed(4),
    worstWhere,
    height: +(hi - lo).toFixed(3),
    foot: +lo.toFixed(3),
    triangles: Math.round(tris),
    handMoved: hand ? +before.distanceTo(after).toFixed(4) : null,
    materials: (() => { const s = new Set(); root.traverse((o) => o.material && s.add(o.material.uuid)); return s.size; })(),
  };
});
await browser.close();

if (out.error) { console.log(' ✗', out.error); process.exit(1); }

let bad = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? ' ✓' : ' ✗'} ${label}${extra ? '  ' + extra : ''}`);
};

console.log('\n── the rig ──');
console.log(`  ${out.bones} bones, ${out.clips} clips, ${out.triangles} triangles, ${out.materials} materials`);
console.log(`  stands ${out.height} m, feet at ${out.foot}`);

console.log('\n── one file, one rig ──');
ok('the mesh is skinned', out.bones > 0);
ok('every clip drives bones that exist', out.missing.length === 0,
  out.missing.length ? out.missing.slice(0, 4).join(', ') : `${out.clips} clips checked`);
ok('a clip actually moves the figure', (out.handMoved ?? 0) > 0.001,
  `hand travels ${out.handMoved} m`);

/*
 * The scale assertion is the one that matters most, and it is here because of
 * a specific bug: a `upperarm_r.scale` of 3.491 on the pistol aim clip threw
 * the hand 2.1 m from a shoulder on an arm 0.51 m long. That value was not in
 * the pack — it was manufactured by the old stylised build, which multiplied
 * bone scale into the clips and compounded when it ran twice. Asserting it at
 * the source means any future build step that does the same is caught here
 * rather than in a screenshot.
 */
console.log('\n── nothing resizes a bone ──');
ok('no clip animates bone scale away from 1', Math.abs(out.worstScale - 1) < 0.02,
  out.worstWhere ? `worst ${out.worstScale} on ${out.worstWhere}` : `${out.scaleTracks} scale tracks`);

console.log('\n── against the capsule ──');
ok('the figure is between 1.6 m and 2.0 m tall', out.height > 1.6 && out.height < 2.0,
  `${out.height} m`);

console.log(bad ? `\n${bad} failure(s)` : '\nthe rig is sound');
process.exit(bad ? 1 : 0);
