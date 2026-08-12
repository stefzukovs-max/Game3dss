/**
 * Rig probe.
 *
 * Measures the character rig through three's own GLTFLoader, in the browser,
 * for the same reason `prop-info.mjs` does: the file on disk is quantized, so
 * reading the accessors directly in Node reports positions in the tens of
 * thousands. Whatever three says the bind pose is, is what the garment builder
 * has to cut against.
 *
 * Prints the bind-pose height of every bone so the hems in `outfit.js` can be
 * written as real measurements rather than guesses.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });

const out = await page.evaluate(async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const g = await new GLTFLoader().loadAsync('/assets/models/people/body.glb');
  const log = [];

  g.scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(g.scene);
  log.push(`world bounds  min ${box.min.toArray().map((v) => v.toFixed(3))}`);
  log.push(`world bounds  max ${box.max.toArray().map((v) => v.toFixed(3))}`);
  log.push(`height ${(box.max.y - box.min.y).toFixed(3)} m`);

  const skins = [];
  g.scene.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  for (const s of skins) {
    const p = s.geometry.attributes.position;
    log.push(`skinned "${s.name}" mat=${s.material.name} verts=${p.count} tris=${(s.geometry.index?.count ?? p.count) / 3}`);
    log.push(`   local bbox ${JSON.stringify(s.geometry.boundingBox ?? (s.geometry.computeBoundingBox(), s.geometry.boundingBox))}`);
    log.push(`   attrs ${Object.keys(s.geometry.attributes).join(',')}`);
    log.push(`   maps ${['map', 'normalMap', 'roughnessMap', 'aoMap'].filter((k) => s.material[k]).join(',') || 'none'}`);
  }

  /*
   * Bone heights in the body mesh's own local space. This is the space the
   * garment cutter works in, because that is the space the vertex positions
   * are stored in — going via world would fold in the armature's -90° X.
   */
  const body = skins.find((s) => s.material.name.includes('Superhero')) ?? skins[0];
  const inv = body.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  const rows = [];
  for (const b of body.skeleton.bones) {
    b.updateMatrixWorld(true);
    v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
    rows.push([b.name, v.x, v.y, v.z]);
  }
  /*
   * Landmarks, in the same rest space `outfit.js` cuts against. Bone heights
   * alone are not enough to place a bandana or a face covering: the Head bone
   * sits at the jaw hinge, nowhere near the crown, so headwear placed off it
   * lands across the eyes.
   */
  const bodyMesh = body;
  const D = new THREE.Matrix4()
    .copy(bodyMesh.bindMatrixInverse)
    .multiply(bodyMesh.skeleton.bones[0].matrixWorld)
    .multiply(bodyMesh.skeleton.boneInverses[0])
    .multiply(bodyMesh.bindMatrix)
    .premultiply(bodyMesh.matrixWorld);
  log.push('--- rest-space extents (metres above ground) ---');
  for (const s of skins) {
    const p = s.geometry.attributes.position;
    const bb = new THREE.Box3();
    const t = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) bb.expandByPoint(t.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(D));
    log.push(`  ${s.name.padEnd(16)} y ${bb.min.y.toFixed(3)} → ${bb.max.y.toFixed(3)}   ` +
      `x ±${bb.max.x.toFixed(3)}  z ${bb.min.z.toFixed(3)} → ${bb.max.z.toFixed(3)}`);
  }
  {
    // how wide the body is at each height, which is what the cut scopes need
    const p = bodyMesh.geometry.attributes.position;
    const t = new THREE.Vector3();
    const wide = new Map();
    for (let i = 0; i < p.count; i++) {
      t.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(D);
      const band = Math.round(t.y * 20) / 20;
      wide.set(band, Math.max(wide.get(band) ?? 0, Math.abs(t.x)));
    }
    log.push('--- half-width by height ---');
    for (const k of [...wide.keys()].sort((a, b) => b - a)) {
      if (k < 1.35) continue;
      log.push(`  y ${k.toFixed(2)}  half-width ${wide.get(k).toFixed(3)}`);
    }
  }

  /*
   * Where the skin actually is around each bone gear hangs off. Rigid kit is
   * positioned by hand, and "a bit in front of the chest" guessed from the bone
   * position alone buries it: the spine bones sit near the body's axis, not on
   * its surface, so every offset has to clear a different amount of anatomy.
   */
  /*
   * The foot, in rest space. Footwear is modelled rather than cut, so it has to
   * be built to the foot's real extents — the foot bone sits at the ankle, a
   * long way behind the toes, and a boot placed from the bone alone ends up
   * behind the foot with the toes poking out of the front of it.
   */
  {
    const p = bodyMesh.geometry.attributes.position;
    const si = bodyMesh.geometry.attributes.skinIndex;
    const sw = bodyMesh.geometry.attributes.skinWeight;
    const names = bodyMesh.skeleton.bones.map((b) => b.name);
    const want = new Set(['foot_l', 'ball_l', 'ball_leaf_l']);
    const bb = new THREE.Box3();
    const t = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      let m = 0;
      for (const k of ['X', 'Y', 'Z', 'W']) {
        if (want.has(names[si[`get${k}`](i)])) m += sw[`get${k}`](i);
      }
      if (m < 0.6) continue;
      bb.expandByPoint(t.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(D));
    }
    log.push('--- left foot, rest space ---');
    log.push(`  x ${bb.min.x.toFixed(3)} → ${bb.max.x.toFixed(3)}   ` +
      `y ${bb.min.y.toFixed(3)} → ${bb.max.y.toFixed(3)}   ` +
      `z ${bb.min.z.toFixed(3)} → ${bb.max.z.toFixed(3)}`);
    log.push(`  foot_l bone at x 0.114 y 0.086 z -0.088 — offsets are relative to that`);
  }

  log.push('--- body surface near the mounting bones ---');
  {
    const p = bodyMesh.geometry.attributes.position;
    const t = new THREE.Vector3();
    const probes = [
      ['spine_02 (pouches)', 1.18, 0.09],
      ['spine_03 (chain)', 1.34, 0.09],
      ['clavicle (radio)', 1.47, 0.20],
      ['pelvis (bum bag)', 0.98, 0.12],
      ['calf (knee pad)', 0.60, 0.16],
      ['thigh (holster)', 0.84, 0.22],
    ];
    for (const [label, at, band] of probes) {
      let front = -9, side = 0;
      for (let i = 0; i < p.count; i++) {
        t.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(D);
        if (Math.abs(t.y - at) > 0.03 || Math.abs(t.x) > band) continue;
        front = Math.max(front, t.z);
        side = Math.max(side, Math.abs(t.x));
      }
      log.push(`  ${label.padEnd(20)} y ${at}  front z ${front.toFixed(3)}  half-width ${side.toFixed(3)}`);
    }
  }

  rows.sort((a, c) => c[2] - a[2]);
  log.push('--- bones, body-local, tallest first ---');
  for (const [n, x, y, z] of rows) {
    if (/leaf|index|middle|pinky|ring|thumb/.test(n)) continue;
    log.push(`  ${n.padEnd(12)} x ${x.toFixed(3).padStart(7)}  y ${y.toFixed(3).padStart(7)}  z ${z.toFixed(3).padStart(7)}`);
  }
  return log;
});

for (const l of out) console.log(l);
await browser.close();
