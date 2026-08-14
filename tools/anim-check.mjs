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
  /*
   * ── does aiming survive movement? ──
   *
   * The aim pose used to be a whole-body clip, so it only played standing
   * still: one step while aimed and the arms dropped into a run cycle with the
   * gun swinging at the shooter's side. Since most of a firefight happens while
   * moving, that was the animation nobody ever saw working.
   *
   * Measured on the weapon hand, relative to the pelvis, in the character's own
   * frame while jogging: aiming should carry it forward and up. Comparing
   * against the same jog un-aimed isolates the layer from the run cycle itself.
   */
  const handWhileMoving = (aiming) => {
    p.yaw = 0; p.pitch = 0;
    g.input.buttons[2] = aiming;
    g.input.keys.add('KeyW');
    for (let i = 0; i < 40; i++) g._tick(1 / 60);
    const hand = p.model.body?.getObjectByName('hand_r');
    const hips = p.model.body?.getObjectByName('pelvis');
    g.input.keys.delete('KeyW');
    g.input.buttons[2] = false;
    if (!hand || !hips) return null;
    hand.updateWorldMatrix(true, false); hips.updateWorldMatrix(true, false);
    const d = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld));
    // the model faces +Z before the caller's half turn, so -Z is "in front"
    return { fwd: +(-d.z).toFixed(3), up: +d.y.toFixed(3) };
  };
  const jogHip = handWhileMoving(false);
  const jogAim = handWhileMoving(true);
  if (jogHip && jogAim) {
    res.aimLayerFwd = +(jogAim.fwd - jogHip.fwd).toFixed(3);
    res.aimLayerUp = +(jogAim.up - jogHip.up).toFixed(3);
  }

  const up = headOffset(0.9);
  const down = headOffset(-0.9);
  g.input.buttons[2] = false;
  res.pitchUp = up; res.pitchDown = down;
  if (up && down) {
    res.pitchSwingZ = +Math.abs(up[2] - down[2]).toFixed(3);
    res.pitchSwingX = +Math.abs(up[0] - down[0]).toFixed(3);
  }
  /* ── the off hand on the weapon ── */
  {
    const pl = g.player;
    pl.switchTo?.('smg');
    // aiming, because that is when the weapon comes to the centre line and
    // the off hand can physically reach it — see _offHand in actor.js
    g.input.buttons[2] = true;
    for (let i = 0; i < 60; i++) g._tick(1 / 60);
    const m = pl.model;
    m.root.updateMatrixWorld(true);
    const bone = (n) => { let f = null; m.root.traverse((o) => { if (o.name === n) f = o; }); return f; };
    const lh = bone('hand_l');
    const grip = m.foregripNode;
    if (lh && grip) {
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      lh.getWorldPosition(a); grip.getWorldPosition(b);
      res.gripGap = +a.distanceTo(b).toFixed(3);
      res.twoHanded = !!m.twoHanded;
      // can the arm even get there? shoulder-to-target against its own length
      const sh = bone('upperarm_l'), el = bone('lowerarm_l');
      if (sh && el) {
        const S = new THREE.Vector3(), E = new THREE.Vector3();
        sh.getWorldPosition(S); el.getWorldPosition(E);
        res.armReach = +(S.distanceTo(E) + E.distanceTo(a)).toFixed(3);
        res.gripDist = +S.distanceTo(b).toFixed(3);
        // where is the gun, actually?
        const rh = bone('hand_r'), R = new THREE.Vector3();
        rh?.getWorldPosition(R);
        const mz = new THREE.Vector3();
        m.muzzleNode?.getWorldPosition(mz);
        res.gun = {
          handToMuzzle: +R.distanceTo(mz).toFixed(3),
          handToGrip: +R.distanceTo(b).toFixed(3),
          mountScale: +(m.rightHand?.scale.x ?? 0).toFixed(3),
          shoulderToHand: +S.distanceTo(R).toFixed(3),
        };
      }
    } else {
      res.gripMissing = { hand: !!lh, grip: !!grip, weapon: !!m.weaponModel };
    }
    // and a pistol should not drag the off hand onto it
    pl.switchTo?.('pistol');
    for (let i = 0; i < 40; i++) g._tick(1 / 60);
    res.pistolTwoHanded = !!m.twoHanded;
    g.input.buttons[2] = false;
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
let res_;
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

if (out.gripMissing) console.log('\n  grip probe found nothing:', JSON.stringify(out.gripMissing));
if (out.gripGap != null) {
  console.log('\n── holding the weapon ──');
  /*
   * Every clip in the library was authored with a pistol, so the left arm
   * swings free through all of them and a rifle was carried one-handed. A
   * two-bone solve now puts the off hand on the weapon's foregrip after the
   * mixer has run. This is the number that says whether it landed — and it
   * is worth asserting rather than eyeballing, because an IK solve that
   * silently stops converging looks like an animation choice.
   */
  console.log(`   arm reach ${out.armReach} m, shoulder to foregrip ${out.gripDist} m`);
  console.log(`   gun: ${JSON.stringify(out.gun)}`);
  /*
   * The off-hand grip is switched off in actor.js — see OFF_HAND_IK there for
   * why. These stay as printed diagnostics rather than assertions, because a
   * check that fails on a deliberately disabled feature trains people to
   * ignore the suite. What IS asserted is the weapon's size, which is the
   * part that shipped: a submachine gun should measure about its real length
   * from the hand, and at one point measured 94 cm.
   */
  say(out.gun && out.gun.handToMuzzle < 0.70,
    'the weapon is the size of a weapon',
    `${out.gun?.handToMuzzle} m hand to muzzle`);
  say(out.pistolTwoHanded === false, 'and a pistol is still held one-handed');
}

if (res_ = out.aimLayerFwd, res_ != null) {
  console.log('\n── aiming while moving ──');
  say(Math.abs(out.aimLayerFwd) > 0.06 || Math.abs(out.aimLayerUp) > 0.06,
    'the weapon hand comes up when aiming on the move',
    `hand moves ${out.aimLayerFwd} m forward, ${out.aimLayerUp} m up vs the same jog un-aimed`);
}

console.log(bad ? `\n${bad} failure(s)` : '\nanimation looks sane');
await browser.close();
process.exit(bad ? 1 : 0);
