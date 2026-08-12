/**
 * Animation bench.
 *
 * Measures where characters are actually pointing and how their feet are
 * cycling, because the two most visible animation bugs are invisible to every
 * other check in this repo: they look completely normal in a still frame, and
 * the sim harness only reads game state, never the scene graph.
 *
 * The one that shipped: both callers set `rotation.y = yaw + π`, correct for a
 * model whose local facing is +Z, and the actor *also* turned its body by π —
 * so every rigged character ran backwards. Every screenshot harness set
 * `root.rotation.y` directly and so never went through a caller, which is
 * exactly why none of them caught it.
 *
 * So: drive the real game, and compare the direction each character faces in
 * the world against the direction it is travelling and the direction it is
 * shooting.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 180000 });

let bad = 0;
const say = (pass, msg, extra = '') => {
  if (!pass) bad++;
  console.log(` ${pass ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`);
};

const out = await page.evaluate(async () => {
  const THREE = await import('three');
  const g = window.__game;
  g.settings.intro = false;
  g.selected.faction = 'gang';
  g.selected.operator = 'boulder';
  g.startRun();
  // long enough for a wave to actually be on the map
  for (let i = 0; i < 260; i++) { g._tick(1 / 60); if (g.state === 'draft') g._closeDraft(); }

  const p = g.player;
  const fwd = new THREE.Vector3();
  const res = {};

  /**
   * Where the character model actually points, in the world.
   *
   * Measured on the node that is *rendered*, not on the root the caller sets.
   * The first version of this read `root` and passed happily with the backwards
   * bug still in place, because the stray half turn was on the body — a child
   * of root — and never appeared in root's own world matrix. Anything upstream
   * of the mesh can lie; the mesh cannot.
   */
  const facing = (model) => {
    const node = model.body ?? model.root;
    node.updateWorldMatrix(true, false);
    // the model's own nose is +Z in its local frame
    return fwd.set(0, 0, 1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()))
      .setY(0).normalize().clone();
  };

  /** Hold a movement key for a while and report facing vs travel. */
  const drive = (key, secs = 0.9) => {
    p.yaw = 0; p.pitch = 0;
    p.vel.set(0, 0, 0);
    g.input.keys.clear();
    g.input.keys.add(key);
    const from = p.pos.clone();
    for (let i = 0; i < secs * 60; i++) g._tick(1 / 60);
    g.input.keys.clear();
    const travel = p.pos.clone().sub(from).setY(0);
    const face = facing(p.model);
    return {
      moved: +travel.length().toFixed(2),
      // +1 means facing the way it is going, -1 means facing away from it
      alongFacing: travel.length() > 0.15
        ? +travel.clone().normalize().dot(face).toFixed(2) : 0,
      face: [+face.x.toFixed(2), +face.z.toFixed(2)],
    };
  };

  res.forward = drive('KeyW');
  res.back = drive('KeyS');

  /*
   * At yaw 0 the player looks down -Z, so a character that is facing where it
   * is aiming has a world facing of (0, -1).
   */
  p.yaw = 0;
  g._tick(1 / 60);
  const f0 = facing(p.model);
  res.aimFacing = [+f0.x.toFixed(2), +f0.z.toFixed(2)];

  // and again a quarter turn round, to prove it tracks yaw rather than a constant
  p.yaw = Math.PI / 2;
  for (let i = 0; i < 20; i++) g._tick(1 / 60);
  const f1 = facing(p.model);
  res.aimFacingTurned = [+f1.x.toFixed(2), +f1.z.toFixed(2)];

  /*
   * The AI: every live agent should face roughly along its own yaw, and none
   * should be spinning — a large frame-to-frame change in facing with no
   * matching change in yaw is the signature of two systems fighting over the
   * same rotation.
   */
  const before = g.agents.filter((a) => a.alive).map((a) => facing(a.model).clone());
  for (let i = 0; i < 6; i++) g._tick(1 / 60);
  const agents = [];
  g.agents.filter((a) => a.alive).forEach((a, i) => {
    const now = facing(a.model);
    const want = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
    agents.push({
      towardYaw: +now.dot(want).toFixed(2),
      spinPerFrame: before[i] ? +Math.acos(Math.min(1, Math.max(-1, now.dot(before[i])))).toFixed(3) : 0,
    });
  });
  res.agents = agents;
  res.agentCount = agents.length;

  /*
   * Aim pitch bends the spine, and the pack's bones use Unreal's axis
   * convention — so "rotation.x" is not guaranteed to be the axis that nods.
   * If it is the wrong one the character leans sideways or corkscrews while
   * aiming, which is what "aiming weirdly" looks like from the outside.
   *
   * Measured on the head, relative to the pelvis, in the character's own
   * frame: looking up and looking down should move it along the nose and
   * vertically, and should barely move it sideways at all.
   */
  const headOffset = (pitch) => {
    p.yaw = 0; p.pitch = pitch;
    g.input.buttons[2] = true;                 // hold ADS
    for (let i = 0; i < 24; i++) g._tick(1 / 60);
    const head = p.model.body?.getObjectByName('Head');
    const hips = p.model.body?.getObjectByName('pelvis');
    if (!head || !hips) return null;
    head.updateWorldMatrix(true, false); hips.updateWorldMatrix(true, false);
    const d = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld));
    return [+d.x.toFixed(3), +d.y.toFixed(3), +d.z.toFixed(3)];
  };
  const up = headOffset(0.9);
  const down = headOffset(-0.9);
  g.input.buttons[2] = false;
  res.pitchUp = up; res.pitchDown = down;
  if (up && down) {
    res.pitchSwingZ = +Math.abs(up[2] - down[2]).toFixed(3);
    res.pitchSwingX = +Math.abs(up[0] - down[0]).toFixed(3);
  }
  return res;
});

console.log('\n── the player ──');
say(out.forward.alongFacing > 0.8, 'runs the way it faces',
  `dot ${out.forward.alongFacing}, moved ${out.forward.moved} m`);
say(out.back.alongFacing < -0.8, 'backs away while still facing forward',
  `dot ${out.back.alongFacing}, moved ${out.back.moved} m`);
say(Math.abs(out.aimFacing[1] + 1) < 0.15 && Math.abs(out.aimFacing[0]) < 0.15,
  'faces where it aims at yaw 0', `facing ${out.aimFacing}`);
say(Math.abs(out.aimFacingTurned[0] + 1) < 0.2,
  'facing follows yaw a quarter turn round', `facing ${out.aimFacingTurned}`);

console.log(`\n── ${out.agentCount} agents ──`);
const off = out.agents.filter((a) => a.towardYaw < 0.7);
say(off.length === 0, 'all agents face along their own yaw',
  off.length ? `${off.length} do not: ${JSON.stringify(off.slice(0, 3))}` : '');
const spun = out.agents.filter((a) => a.spinPerFrame > 0.5);
say(spun.length === 0, 'no agent is spinning',
  spun.length ? `${spun.length} turning >0.5 rad/frame` : '');

if (out.pitchSwingZ != null) {
  console.log('\n── aim pitch ──');
  say(out.pitchSwingZ > 0.03, 'looking up and down nods the spine',
    `head moves ${out.pitchSwingZ} m along the nose`);
  say(out.pitchSwingX < out.pitchSwingZ * 0.6, 'and does not tip it sideways',
    `sideways ${out.pitchSwingX} m vs forward ${out.pitchSwingZ} m`);
}

console.log(bad ? `\n${bad} failure(s)` : '\nanimation looks sane');
await browser.close();
process.exit(bad ? 1 : 0);
