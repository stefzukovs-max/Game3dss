import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { damp, clamp, angleDelta } from '../core/utils.js';
import { dress, reshapeBody } from './outfit.js';
import { chibify } from './chibi.js';
import { solveTwoBone } from './twobone.js';
import { repairModelWeights } from './weights.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  SKINNED ACTOR — a real rigged character
 * ══════════════════════════════════════════════════════════════════
 *
 * Replaces the capsule rig with a modelled human driven by skeletal animation.
 *
 * Two CC0 packs make this work and neither is any use alone: the base pack is a
 * rigged body with no animation, the library is 43 clips with no character
 * worth shipping. They share all 65 bones, so the clips drive the body with no
 * retargeting — that was measured before any of this was written, not assumed.
 *
 * This deliberately implements the same small interface the procedural
 * `CharacterModel` does — `root`, `update(dt, state)`, `faceYaw`, `setPosition`,
 * `flash`, `dispose`, `deadBlend`, `rightHand` — so player.js and ai.js do not
 * know or care which one they were handed. Without the pack the game falls back
 * to the old rig exactly as before.
 */

/* ── the shared source, loaded once ─────────────────────────────── */
let SOURCE = null;      // { body: Object3D, clips: Map<string, AnimationClip> }

/**
 * Hand the actor system the loaded packs.
 *
 * @returns {boolean} whether skinned characters are available
 */
export function setActorSource(assets) {
  const body = assets?.models.get('people:body');
  if (!body || !assets.clips?.length) { SOURCE = null; return false; }

  /*
   * Reshape the shared body before anything is cloned or cut from it. The pack
   * ships a comic-book physique; left alone it makes every character on the map
   * a bodybuilder, and the clothing — which is cut from this surface — inherits
   * it.
   */
  reshapeBody(body);

  const clips = new Map();
  for (const c of assets.clips) clips.set(c.name, c);
  /*
   * Two bodies on one skeleton.
   *
   * `armored` is the supplied police figure, re-bound onto this exact rig by
   * `tools/rebind-character.py` — same 65 bones, same names, same rest pose —
   * so every clip in the library drives it without a retarget, and the grip
   * measured off the base body is valid on it too. Absent, the police fall
   * back to the base body in cut clothing, exactly as before.
   */
  const bodies = { base: body };
  for (const kind of ['armored', 'crew']) {
    const m = assets.models.get(`people:${kind}`);
    if (m) bodies[kind] = m;
  }

  /*
   * The stylised build. Every body shares this skeleton by construction — that
   * is the whole reason the re-bind tool exists — so each one gets the same
   * per-bone factors, and the clips are restyled once for all of them.
   *
   * Order matters: this runs before anything is cloned, before the grip is
   * measured off the aim pose, and before the clothing is cut from the body
   * surface. Measuring the grip on a normal arm and then shortening it would
   * leave every barrel pointing somewhere it was not calibrated for.
   */
  for (const b of Object.values(bodies)) chibify(b, assets.clips);

  /*
   * Repair the skinning, after the build and before anything is cloned.
   *
   * This is where the police model's pale shards came from — vertices re-bound
   * to bones on the far side of the body, and hands, thighs and head stitched
   * to each other by the model reduction's weld. Both are invisible in the
   * bind pose and tear metre-long triangles out of the figure the moment the
   * skeleton moves. See weights.js.
   *
   * After `chibify`, deliberately: the build's bone scales are part of what
   * tears the mesh — a head bone at 1.92 throws anything wrongly weighted to
   * it half a metre — so the repair has to see the skeleton the game will
   * actually animate, not the one the pack shipped.
   *
   * Runs on every body, not just the one that was noticed, so the next
   * re-bound character gets checked without anyone remembering to.
   */
  const repairs = [];
  for (const [kind, b] of Object.entries(bodies)) {
    const r = repairModelWeights(b);
    if (r?.length) repairs.push({ kind, meshes: r });
  }
  if (typeof window !== 'undefined') window.__weightRepairs = repairs;

  /*
   * ── an upper-body-only copy of the aim pose ──
   *
   * The single worst thing about how this game animated: aiming was a whole-
   * body clip, so it could only play while standing still. Take one step while
   * aimed — which is most of a firefight — and the aim pose was replaced
   * outright by a jog, the arms dropped to a run cycle, and the gun pointed
   * wherever the hand bone happened to swing. The character never once looked
   * like they were aiming at the thing the player was shooting.
   *
   * The fix is a layer, and three.js gives it for free once you see it: the
   * mixer blends per *property*, so an action whose tracks only touch the spine
   * and arms leaves the legs entirely to whatever else is playing. Filtering
   * the aim clip's tracks down to the upper body turns it into an overlay that
   * runs on top of a walk, a jog or a sprint.
   *
   * No masks, no second mixer, no additive setup — just a clip that declines to
   * mention the legs.
   */
  const UPPER = /^(spine_|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|ring_|pinky_|thumb_|neck_|Head)/;
  const aimClip = clips.get(LOCO.aim) ?? clips.get(LOCO.aimIdle);
  if (aimClip) {
    const upper = aimClip.clone();
    upper.name = AIM_UPPER;
    upper.tracks = upper.tracks.filter((t) => UPPER.test(t.name.split('.')[0]));
    if (upper.tracks.length) clips.set(AIM_UPPER, upper);
  }

  SOURCE = { body, bodies, clips, grip: gripFromAimPose(body, clips) };
  return true;
}

/**
 * Work out how a weapon has to sit in the hand, by asking the animation.
 *
 * A weapon is parented to the hand bone, so its orientation is whatever the
 * bone's happens to be — and this pack uses Unreal's axis convention, where the
 * hand's local axes have no particular relationship to "forward". Hand-tuned
 * Euler angles would work until the day the pack is updated and then fail
 * silently, pointing every barrel at the floor.
 *
 * So it is measured instead: pose the rig in the library's own pistol-aim clip,
 * which is authored to aim straight ahead, and read back the rotation that puts
 * the barrel where the animator was aiming. The clip is the specification.
 */
function gripFromAimPose(source, clips) {
  const aim = clips.get(LOCO.aim) ?? clips.get(LOCO.aimIdle);
  const rig = cloneSkinned(source);
  const hand = rig.getObjectByName(HAND_BONE);
  if (!hand || !aim) return new THREE.Quaternion();

  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(aim).play();
  mixer.update(0);
  rig.updateMatrixWorld(true);

  const rel = new THREE.Matrix4().copy(rig.matrixWorld).invert().multiply(hand.matrixWorld);
  const inHand = new THREE.Quaternion().setFromRotationMatrix(rel).invert();

  /*
   * The weapon models are built barrel-down-negative-Z and the pack's character
   * faces +Z, so a weapon aligned with the body needs a half turn before it is
   * handed to the bone. This is measured in the pack's own untouched frame, so
   * it is unaffected by how the actor is oriented in the world.
   */
  const forward = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  mixer.stopAllAction();
  return inHand.multiply(forward);
}

export const actorsReady = () => !!SOURCE;

/*
 * The state machine.
 *
 * Locomotion is picked from ground speed and stance; everything else is a
 * one-shot layered on top. The names are the library's own — keeping them
 * verbatim means a missing clip is obvious at a glance rather than silently
 * falling back to idle.
 */
const LOCO = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  crouchIdle: 'Crouch_Idle_Loop',
  crouchMove: 'Crouch_Fwd_Loop',
  aimIdle: 'Pistol_Idle_Loop',
  aim: 'Pistol_Aim_Neutral',
  dead: 'Death01',
  hit: 'Hit_Chest',
  jump: 'Jump_Loop',
};

/*
 * Bone names, as the pack actually ships them: Unreal's convention, not
 * Mixamo's. Worth stating rather than inlining, because a wrong bone name here
 * fails silently — `getObjectByName` returns undefined, the weapon quietly
 * parents to the root and the aim pitch quietly does nothing.
 */
/** The upper-body slice of the aim pose, derived at load. See setActorSource. */
const AIM_UPPER = 'Aim_Upper';

const HAND_BONE = 'hand_r';

/*
 * ══════════════════════════════════════════════════════════════════
 *  The rig is 45% of the size the rest of the game thinks it is
 * ══════════════════════════════════════════════════════════════════
 *
 * Every clip in the animation library writes 0.4495 to the `root` bone's
 * scale. It is the pack's own unit conversion; it is in all forty-three
 * clips; and because the mixer writes scale every frame it lands the instant
 * anything plays. Measured on a standing player: foot bone to head bone,
 * 52 centimetres. The whole arm, shoulder to wrist, 23.
 *
 * Nothing caught it for the life of the project because everything that
 * measured a character measured the *source* model in bind space, where the
 * clips have not run and the figure is a correct 1.82 m.
 *
 * It explains a run of separate-looking bugs that were each chased on their
 * own terms: the submachine gun that "looked like a black stick" was
 * correctly sized in metres beside a man half a metre tall; the off hand
 * could not reach the weapon's foregrip because there is only 23 cm of arm
 * to reach with; and worst of all the collision capsule, the camera height
 * and every hitbox are written against 1.82 m, so the head you could see and
 * the head you could shoot were not in the same place.
 *
 * Fixing it in the clips would be tidier and does not work — dividing the
 * root track's values leaves them at 0.4495 no matter that the loop runs and
 * the guard flag is set, which is worth returning to. Scaling the actor's
 * own root undoes it where it can be seen.
 *
 * The number is 2.379 rather than 1/0.4495 = 2.225 because undoing the pack's
 * factor is not the goal — standing 1.82 m is, and this build has short chibi
 * legs that lose the difference. It was measured, not derived: skinning
 * applied on the CPU with `applyBoneTransform`, which is the only way to see
 * a skinned mesh's real size. `Box3.setFromObject` reads bind-space geometry
 * and is blind to every bone transform, which is precisely how a rig at 45%
 * of its intended size survived this long unnoticed.
 */
export const RIG_UNIT_FIX = 2.379;

/*
 * How big a gun reads, as a multiplier on its real-world length.
 *
 * It was 1.35, which was right when the build still had realistic arms and
 * absurd once they came down to 0.62: a 52 cm submachine gun became 70 cm on
 * a figure whose whole forearm is 25, and read on screen as a black stick
 * held at arm's length rather than as a weapon.
 *
 * The number is not in metres and is not a clean multiplier on the weapon's
 * real length, because the compensation it feeds does not fully cancel: the
 * animation clips carry their own scale tracks, the build multiplies into
 * them, and the hand bone's world scale therefore depends on which clip is
 * playing. At 0.92 the submachine gun measured 94 cm from hand to muzzle on
 * a 1.82 m figure — a stick, which is exactly what it looked like.
 *
 * So it is set against a measurement rather than against a theory.
 * `npm run check:anim` prints hand-to-muzzle; keep it near the weapon's real
 * length and it looks held.
 */
const WEAPON_SCALE = 0.5;

/*
 * ── the off-hand grip ──
 *
 * The solver in `twobone.js` works and the plumbing is in place: the weapon
 * carries a foregrip node, the actor reaches for it after everything else in
 * the frame, and the reach fades out rather than clamping. What does not add
 * up yet is the geometry it is reaching across.
 *
 * It was switched off for a while because the arm could not reach: measured
 * while aiming, the off shoulder sat 0.93 m from the weapon hand and each arm
 * was 0.27 m long. Those two numbers cannot both be true of a 1.82 m person,
 * and the reason they were is `RIG_UNIT_FIX` above — the whole skeleton was
 * running at 45% scale, so the arms were less than a third of the length the
 * geometry around them assumed. With that corrected the arm is 0.55 m and the
 * reach is ordinary.
 *
 * It is still gated on reach rather than forced: see the fade in `_offHand`.
 */
const OFF_HAND_IK = true;

/**
 * Outward swing at the shoulder, in radians. See `_splayArms`.
 *
 * Tuned against `npm run check:skin`, which measures the closest approach
 * between arm surface and torso surface across every pose the game plays:
 * at 0 the gang body touches itself in all nine, and this is the smallest
 * value that clears them all with room to spare. Larger reads as a swagger
 * and starts to fight the aim pose.
 */
const SPLAY = 0.12;

const _splayQ = new THREE.Quaternion();
const _splayQ2 = new THREE.Quaternion();
const _splayP = new THREE.Quaternion();
const _splayRot = new THREE.Quaternion();
const _splayA = new THREE.Vector3();
const _splayB = new THREE.Vector3();
const _splayDir = new THREE.Vector3();
const _splayWant = new THREE.Vector3();
const _splayOut = new THREE.Vector3();
const _splayFwd = new THREE.Vector3();

const _ws = new THREE.Vector3();
const _ikTarget = new THREE.Vector3();
const _ikPole = new THREE.Vector3();
const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikC = new THREE.Vector3();
const SPINE = ['spine_03', 'spine_02'];

export class SkinnedActor {
  /** @param {object} outfit the same outfit record the procedural rig takes */
  constructor(outfit) {
    this.o = outfit;
    this.root = new THREE.Group();
    this.deadBlend = 0;
    this._cur = null;
    this._hitUntil = 0;
    this._kick = 0;

    /*
     * SkeletonUtils.clone, not Object3D.clone. A plain clone copies the meshes
     * and the bones but leaves every SkinnedMesh bound to the *original*
     * skeleton, so every character in the level animates as one body. This is
     * the single easiest way to get skinned instancing wrong.
     */
    /*
     * No half turn here, deliberately.
     *
     * The pack models face +Z, and so does the rig this replaces: both player
     * and AI set `rotation.y = yaw + π`, which turns a +Z-facing model to the
     * game's forward of −Z. Adding another π inside the actor cancelled that
     * exactly, and every rigged character in the game ran backwards — facing
     * the way it had come while its legs cycled forwards.
     *
     * It was invisible in the character harnesses because they set
     * `root.rotation.y` directly and never went through a caller.
     */
    /*
     * A finished figure wears no cut clothing and takes no skin tint. The
     * armoured police model arrives fully dressed and fully textured, so both
     * of those passes are for the bare body only — running them on the
     * armoured one would recolour a plate carrier as though it were forearm.
     */
    const kind = SOURCE.bodies[outfit.body] ? outfit.body : 'base';
    const dressed = kind === 'base';
    const body = cloneSkinned(SOURCE.bodies[kind]);
    this.root.add(body);
    this.body = body;

    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;          // self-shadowing on a 14k body is noise
      o.frustumCulled = false;          // skinned bounds go stale as it moves
      if (dressed) o.material = this._skin(o.material);
    });

    /*
     * The pack is a bare body — six anatomies and no clothes, and there is no
     * CC0 outfit set that shares this skeleton. `dress` cuts the clothing out
     * of the body itself so it inherits the skin weights; see outfit.js.
     */
    this.worn = dressed ? dress(body, outfit) : [];

    /*
     * Weapons hang off a calibrated mount rather than off the bone itself, so
     * `attachWeapon` can stay ignorant of which rig it is talking to.
     */
    const hand = body.getObjectByName(HAND_BONE);
    if (hand) {
      const mount = new THREE.Group();
      mount.quaternion.copy(SOURCE.grip);
      mount.position.set(0, -0.012, 0.035);   // wrist bone to the middle of the fist
      hand.add(mount);
      this.rightHand = mount;
      this._handBone = hand;
    } else {
      this.rightHand = body;
      this._handBone = null;
    }
    // the mount is already oriented; the legacy pose is for the capsule rig
    this.weaponPose = { position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0) };

    /*
     * Undo the pack's root scale. Callers set their own size on top of this
     * — an elite is 1.05, a light frame 0.96 — so `setSize` multiplies
     * rather than assigns, and nobody outside has to know the fix exists.
     */
    this.root.scale.setScalar(RIG_UNIT_FIX);

    this.mixer = new THREE.AnimationMixer(body);
    this._actions = new Map();
    this._play(LOCO.idle, 0);
    this._footDrop = this._measureFootDrop(kind);
  }

  /**
   * Per-character material for the body itself — which is skin, since the
   * clothes are separate meshes cut on top of it.
   *
   * Cloning the material per character costs a little more state than sharing
   * one would, but sharing means the whole crew changes complexion whenever one
   * of them does. The geometry, which is the expensive part, is still shared.
   */
  _skin(src) {
    const m = src.clone();
    const o = this.o;
    const name = (src.name || '').toLowerCase();

    if (name.includes('hair')) {
      m.color = new THREE.Color(o.hair ?? 0x1b1310);
    } else if (name.includes('eye')) {
      m.color = new THREE.Color(0xffffff);
    } else {
      /*
       * Tint, do not replace.
       *
       * `color` multiplies the base texture, so assigning a skin tone straight
       * in stacks two darkenings on top of each other and the whole roster
       * comes out as glossy mannequins. Lifting the tint halfway to white lets
       * the scanned texture keep carrying the form while the tone still varies
       * across the crowd.
       */
      const tint = new THREE.Color(o.skin ?? 0xc68642);
      m.color = tint.lerp(new THREE.Color(0xffffff), 0.5);
    }

    // skin is dielectric and rough; the pack ships it shinier than that, which
    // is most of why untinted it reads as latex
    m.roughness = Math.max(m.roughness ?? 0.9, 0.86);
    m.metalness = 0;
    m.envMapIntensity = 0.7;
    return m;
  }

  /** Cross-fade to a clip. No-op when it is already the current one. */
  _play(name, fade = 0.22) {
    if (this._cur === name) return;
    const clip = SOURCE.clips.get(name);
    if (!clip) return;

    let action = this._actions.get(name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this._actions.set(name, action);
    }
    const prev = this._cur && this._actions.get(this._cur);
    action.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(action, fade, false);
    else if (prev) prev.stop();
    this._cur = name;
  }

  /** One-shot that returns to locomotion when it finishes. */
  _oneShot(name, hold) {
    const clip = SOURCE.clips.get(name);
    if (!clip) return;
    this._play(name, 0.08);
    const a = this._actions.get(name);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    this._hitUntil = hold;
  }

  /**
   * @param {number} dt
   * @param {{speed:number, aiming:boolean, crouching:boolean, pitch:number,
   *          dead:boolean, airborne?:boolean, hurt?:boolean}} s
   */
  update(dt, s) {
    this.deadBlend = damp(this.deadBlend, s.dead ? 1 : 0, s.dead ? 7 : 20, dt);

    if (s.dead) {
      if (this._cur !== LOCO.dead) {
        const a = this.mixer.clipAction(SOURCE.clips.get(LOCO.dead));
        if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        this._play(LOCO.dead, 0.12);
      }
      this.mixer.update(dt);
      return;
    }

    if (s.hurt && this._hitUntil <= 0) this._oneShot(LOCO.hit, 0.42);
    this._hitUntil -= dt;

    if (this._hitUntil <= 0) {
      const speed = s.speed || 0;
      const moving = speed > 0.3;
      let want;
      if (s.airborne) want = LOCO.jump;
      else if (s.crouching) want = moving ? LOCO.crouchMove : LOCO.crouchIdle;
      else if (!moving) want = s.aiming ? LOCO.aim : LOCO.idle;
      else if (speed > 5.4) want = LOCO.sprint;
      else if (speed > 2.6) want = LOCO.jog;
      else want = LOCO.walk;
      this._play(want);

      /*
       * The aim overlay rides on top of the locomotion, so a character can walk
       * and aim at the same time. It is skipped when the full-body aim clip is
       * already the base — layering a pose over itself does nothing but cost a
       * blend — and while sprinting, because nobody sprints down their sights.
       */
      this._aimLayer(s.aiming && moving && want !== LOCO.sprint, dt);

      /*
       * Which way the feet should cycle.
       *
       * The library ships forward loops only — no back-pedal and no strafe — so
       * a character walking backwards while facing a target played a forward
       * cycle and moonwalked. Running the same clip in reverse is not a real
       * back-pedal animation, but it puts the feet on the right side of the
       * body at the right time, which is the part the eye actually reads.
       *
       * `fwd` is velocity along the character's own nose; callers know their
       * yaw, so they resolve it rather than the actor guessing from world
       * velocity and a rotation it may not have applied yet.
       */
      this._back = (s.fwd ?? speed) < -0.35;

      /*
       * Play locomotion at the speed the body is actually moving. A walk cycle
       * running at its authored rate under a character travelling at 5 m/s is
       * the classic ice-skating tell, and it is the thing that makes canned
       * animation read as canned.
       */
      const a = this._cur && this._actions.get(this._cur);
      if (a) {
        const ref = this._cur === LOCO.sprint ? 6.4 : this._cur === LOCO.jog ? 3.8 : 1.7;
        const rate = moving ? clamp(speed / ref, 0.55, 1.7) : 1;
        a.timeScale = this._back ? -rate : rate;
      }
    }

    /*
     * Aim pitch, applied on top of the clip. The library has up/neutral/down
     * poses, but blending three clips for what is one rotation costs more than
     * leaning on the spine — and the spine is what a person actually does.
     */
    const spine = (this._spine ??= SPINE.reduce(
      (found, n) => found ?? this.body.getObjectByName(n), null));
    this.mixer.update(dt);
    if (spine && s.aiming) {
      /*
       * The stylised build shortened the neck to 0.55 and the spine barely
       * moved, which put the head far closer to the joint doing the nodding.
       * The same 0.55 factor that used to swing the head ten centimetres along
       * its own sightline moved it two, and aiming up or down stopped reading
       * on the character at all — you could watch an ally track a target three
       * terraces above them without their head leaving level.
       *
       * Rotation is angular and the check is a distance, so the factor has to
       * grow as the lever shrinks. `npm run check:anim` measures the
       * displacement, which is why this is a number that gets caught rather
       * than a number that quietly stops doing anything.
       */
      spine.rotation.x += clamp(s.pitch ?? 0, -0.9, 0.9) * 1.5;
    }

    /*
     * Recoil, on the character rather than only on the camera.
     *
     * Firing used to be invisible from the outside: the camera kicked, the
     * shooter did not move at all. Watch an ally empty a magazine and they were
     * a statue with a noise. This rolls the chest back on each shot and lets it
     * settle, which is most of what reads as a gun going off, and it costs one
     * bone rotation.
     *
     * Applied after `mixer.update` for the same reason the aim pitch is: the
     * mixer overwrites bone rotations outright, so anything added before it is
     * simply gone.
     */
    if (this._kick > 0.0001) {
      if (spine) spine.rotation.x -= this._kick;
      this._kick = damp(this._kick, 0, 16, dt);
    }

    this._holdWeaponSize();
    this._splayArms();
    this._sway(dt, s);
    this._offHand(dt, s);
  }

  /**
   * Swing the upper arms clear of the ribs.
   *
   * The stylised build widens the chest and shortens the limbs, and the
   * animation library was authored for neither. On a realistic figure the arms
   * hang a comfortable few centimetres off the body; on this one, measured
   * across every pose the game plays, the closest approach between arm surface
   * and torso surface was two to eight millimetres — touching. There is no
   * daylight under a gang member's arm in any pose, which is exactly what
   * "the arms are stuck to the body" describes.
   *
   * A few degrees of outward swing at the shoulder is enough to open it, and
   * is what an animator would do rather than re-authoring forty-three clips
   * against a body shape that did not exist when they were made.
   *
   * Done as a world-space rotation of the shoulder-to-elbow direction away
   * from the body's centreline, for the same reason `twobone.js` works that
   * way: this rig's bone axes are not documented anywhere and guessing which
   * local axis is "outward" has been wrong twice. Rotating a direction the
   * character can be *measured* to have needs no convention at all.
   *
   * After the mixer, because the mixer overwrites bone rotations outright and
   * anything set before it is simply gone. Before `_offHand`, so the two-bone
   * solver can still put the support hand exactly on the foregrip — the splay
   * is a starting posture, not a constraint.
   */
  _splayArms() {
    if (!SPLAY) return;
    const arms = (this._splayBones ??= ['l', 'r'].map((side) => ({
      up: this.body.getObjectByName(`upperarm_${side}`),
      low: this.body.getObjectByName(`lowerarm_${side}`),
      sign: side === 'l' ? 1 : -1,
    })).filter((a) => a.up && a.low));
    if (!arms.length) return;

    // the character's own axes, so this works whichever way they are facing
    this.root.getWorldQuaternion(_splayQ);
    _splayOut.set(1, 0, 0).applyQuaternion(_splayQ);      // their left
    _splayFwd.set(0, 0, 1).applyQuaternion(_splayQ);      // their forward

    for (const arm of arms) {
      arm.up.getWorldPosition(_splayA);
      arm.low.getWorldPosition(_splayB);
      _splayDir.subVectors(_splayB, _splayA);
      const len = _splayDir.length();
      if (len < 1e-4) continue;
      _splayDir.divideScalar(len);

      /*
       * Lean the arm's direction outwards by adding a sideways component,
       * rather than rotating it about an axis.
       *
       * The axis version is the obvious one and it degenerates exactly where
       * it is needed most. Rotating about the character's forward axis needs a
       * sign — which way is "out" — and the only thing available to derive it
       * from is the arm's current direction. For an arm hanging straight down
       * that direction has almost no sideways component at all, so the sign
       * came from rounding noise and flipped between frames and between poses.
       * Idle, the pose most in need of daylight under the arm, was the one it
       * could not decide about.
       *
       * Adding a fixed sideways nudge and re-normalising has no such case: the
       * left arm always gains a component to the character's left and the
       * right to its right, whatever the arm is doing, and the size of the
       * resulting angle is largest when the arm hangs closest to the body,
       * which is the right way round.
       */
      _splayWant.copy(_splayDir).addScaledVector(_splayOut, arm.sign * SPLAY).normalize();
      _splayRot.setFromUnitVectors(_splayDir, _splayWant);

      arm.up.getWorldQuaternion(_splayQ2).premultiply(_splayRot);
      arm.up.parent.getWorldQuaternion(_splayP).invert();
      arm.up.quaternion.copy(_splayP.multiply(_splayQ2));
      arm.up.updateMatrixWorld(true);
    }
  }

  /**
   * Keep the gun the size it was authored to be.
   *
   * The weapon mount hangs off `hand_r`, so it inherits that bone's world
   * scale — and bone scale is exactly what the stylised build uses to change
   * the proportions. Scaling the hand up to make it chunky scaled the rifle
   * with it, and because the clips carry their own scale tracks the factor
   * compounded down the arm: the first render of the police squad had five
   * officers holding twenty-metre rifles across the sky, which is a strange
   * thing to look at and took a while to recognise as a gun rather than a
   * building.
   *
   * The fix is to make weapon size an explicit decision. `WEAPON_SCALE` is
   * the one number that controls how big guns read; the bone's own scale is
   * divided straight back out, so the rig can be restyled freely and the
   * weapon stays where the art direction put it.
   */
  /** Size this character, on top of the rig's unit correction. */
  setSize(k = 1) {
    this.root.scale.setScalar(RIG_UNIT_FIX * k);
  }

  _holdWeaponSize() {
    const bone = this._handBone;
    if (!bone) return;
    const s = bone.getWorldScale(_ws).x;
    if (s > 1e-4) this.rightHand.scale.setScalar(WEAPON_SCALE / s);
  }

  /**
   * Put the other hand on the gun.
   *
   * Runs after everything else in the frame — after the mixer, after the aim
   * layer, after the recoil kick and after sway — because it has to reach
   * wherever the weapon *ended up*, not where it was before those moved it.
   * Solving first and then swaying the gun out from under the hand is how you
   * get a character gripping thin air two centimetres from the handguard.
   *
   * Weighted in and out rather than switched: snapping the arm onto the
   * weapon the instant a rifle is drawn is a visible pop, and a pistol wants
   * the clip's own free arm back.
   */
  _offHand(dt, s) {
    let want = OFF_HAND_IK && this.twoHanded && this.foregripNode && !s.dead ? 1 : 0;

    /*
     * ── only when the arm can actually get there ──
     *
     * This build's arms are about twenty centimetres from shoulder to wrist,
     * and both hands are on arms that short. With the weapon down at the hip
     * the foregrip is thirty-seven centimetres from the off shoulder, which
     * is not a tuning problem — it is further than the arm is long, and no
     * solver reaches it. Forcing the issue gives a clamped arm pointing
     * hopefully at a gun it never touches, which looks worse than the free
     * arm it replaced.
     *
     * So reach is checked before it is attempted. When the weapon comes to
     * the centre line — which is what aiming does — the target moves inside
     * range and the hand goes on; drop the weapon back to the hip and the
     * hand comes off. That is also what people do.
     */
    if (want) {
      const a = (this._larm ??= {
        root: this.body.getObjectByName('upperarm_l'),
        mid: this.body.getObjectByName('lowerarm_l'),
        end: this.body.getObjectByName('hand_l'),
      });
      if (a.root && a.mid && a.end) {
        a.root.getWorldPosition(_ikA);
        a.mid.getWorldPosition(_ikB);
        a.end.getWorldPosition(_ikC);
        const span = _ikA.distanceTo(_ikB) + _ikB.distanceTo(_ikC);
        this.foregripNode.getWorldPosition(_ikTarget);
        // fades out over the last 15% of reach rather than switching off
        want = clamp((span * 1.02 - _ikA.distanceTo(_ikTarget)) / (span * 0.15), 0, 1);
      } else {
        want = 0;
      }
    }

    this._ikW = damp(this._ikW ?? 0, want, 9, dt);
    if (this._ikW < 0.02) return;

    const arm = this._larm;
    if (!arm?.root || !arm.mid || !arm.end) return;

    this.foregripNode.getWorldPosition(_ikTarget);
    /*
     * The elbow breaks down and out, away from the body's own left. Taking
     * the pole from the character's world orientation rather than a fixed
     * axis keeps it correct when they turn round, which a world-space
     * constant does not.
     */
    this.root.getWorldDirection(_ikPole);            // −Z of the actor
    _ikPole.set(-_ikPole.z, -1.15, _ikPole.x).normalize();
    solveTwoBone(arm.root, arm.mid, arm.end, _ikTarget, _ikPole, this._ikW);
  }

  /**
   * Weapon sway — the small motion of the gun that is not the animation.
   *
   * The clips move the whole body, so the weapon was rigidly welded to the hand
   * and perfectly still relative to it. A gun that never moves in its own right
   * is the difference between holding a weapon and carrying a prop.
   *
   * Two sources, both cheap:
   *
   *   · **Walking** swings the muzzle in a figure of eight, at a rate tied to
   *     how fast the feet are actually going, so it stays in sympathy with the
   *     stride rather than drifting against it.
   *
   *   · **Breathing**, only while aimed and only once the body has stopped.
   *     It is the slow one, and it is what makes holding a sight line feel like
   *     an effort being made rather than a state being in.
   *
   * Both fade out as the other takes over, so there is never a moment where the
   * weapon is doing two unrelated things at once.
   */
  _sway(dt, s) {
    const m = this.weaponModel;
    if (!m) return;
    this._swayT = (this._swayT ?? 0) + dt;

    const speed = s.speed || 0;
    const walk = Math.min(1, speed / 4.5);
    const t = this._swayT;
    // the stride rate rises with speed; 4.2 rad/s is about a walking cadence
    const stride = t * (4.2 + walk * 3.4);
    const breathe = (1 - walk) * (s.aiming ? 1 : 0.45);

    const x = Math.sin(stride) * 0.012 * walk + Math.sin(t * 1.5) * 0.004 * breathe;
    const y = Math.sin(stride * 2) * 0.009 * walk + Math.sin(t * 1.15 + 0.7) * 0.005 * breathe;
    // aiming pulls the weapon in toward the sight line rather than only zooming
    const inward = (s.aiming ? 1 : 0);
    this._ads = damp(this._ads ?? 0, inward, 12, dt);

    m.position.set(x - 0.02 * this._ads, y + 0.012 * this._ads, -0.035 * this._ads);
    m.rotation.z = Math.sin(stride) * 0.03 * walk;
  }

  /**
   * A shot was fired. `amount` is the weapon's recoil figure; the scale here
   * turns it into a believable few degrees of chest roll.
   */
  kick(amount = 1) {
    this._kick = Math.min(0.16, (this._kick ?? 0) + amount * 0.022);
  }

  /**
   * Fade the upper-body aim pose in and out over the locomotion clip.
   *
   * Weight rather than play/stop: snapping a pose on at full strength mid-stride
   * pops the arms, and the whole point of the layer is that raising the weapon
   * reads as a movement.
   */
  _aimLayer(on, dt) {
    if (!SOURCE.clips.has(AIM_UPPER)) return;
    let a = this._actions.get(AIM_UPPER);
    if (!a) {
      a = this.mixer.clipAction(SOURCE.clips.get(AIM_UPPER));
      a.play();
      this._actions.set(AIM_UPPER, a);
      this._aimW = 0;
    }
    this._aimW = damp(this._aimW ?? 0, on ? 1 : 0, on ? 14 : 9, dt);
    a.setEffectiveWeight(this._aimW);
  }

  faceYaw(yaw, dt, rate = 12) {
    this.root.rotation.y += angleDelta(this.root.rotation.y, yaw) * (1 - Math.exp(-rate * dt));
  }

  /**
   * Stand the character *on* the ground rather than near it.
   *
   * The root is placed at the player's feet, but the rig's soles are not at
   * its own origin — with the unit correction applied they sit 21 centimetres
   * above it, so every character in the game hovered. It was easy to miss at
   * the old scale, where the same offset was under nine centimetres and read
   * as the model being slightly small.
   *
   * The drop is measured once per body from the actual skinned mesh, because
   * a foot bone is at the ankle and what has to touch the floor is the sole.
   */
  setPosition(x, y, z) { this.root.position.set(x, y - this._footDrop, z); }

  /**
   * How far below its own origin this rig's lowest vertex sits, in metres,
   * at unit scale. Measured once per body kind and cached — it is four
   * thousand CPU skinning evaluations, which is nothing once and far too
   * much per spawn.
   */
  static _footDrop = new Map();

  _measureFootDrop(kind) {
    const cached = SkinnedActor._footDrop.get(kind);
    if (cached !== undefined) return cached * this.root.scale.y;

    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    let mesh = null;
    this.root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    let lo = 0;
    if (mesh?.applyBoneTransform) {
      const pos = mesh.geometry.attributes.position;
      const v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 3000));
      lo = Infinity;
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v);
        mesh.localToWorld(v);
        if (v.y < lo) lo = v.y;
      }
      lo = (lo - this.root.position.y) / (this.root.scale.y || 1);
    }
    if (!Number.isFinite(lo)) lo = 0;
    SkinnedActor._footDrop.set(kind, lo);
    return lo * this.root.scale.y;
  }

  flash() {
    if (this._flashing) return;
    this._flashing = true;
    this.root.traverse((m) => {
      if (!m.isMesh) return;
      m.userData.baseMaterial = m.userData.baseMaterial || m.material;
      m.material = FLASH_MATERIAL;
    });
    setTimeout(() => {
      this.root.traverse((m) => {
        if (m.isMesh && m.userData.baseMaterial) m.material = m.userData.baseMaterial;
      });
      this._flashing = false;
    }, 70);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.body);
    this.root.parent?.remove(this.root);
  }
}

const FLASH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffe3e3, toneMapped: false });
