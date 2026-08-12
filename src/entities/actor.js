import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { damp, clamp, angleDelta } from '../core/utils.js';
import { dress, reshapeBody } from './outfit.js';

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
  SOURCE = { body, clips, grip: gripFromAimPose(body, clips) };
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
   * The weapon models are built barrel-down-negative-Z, and the character faces
   * +Z inside its own body (the pack faces the opposite way to the game, hence
   * the half turn in the constructor), so a weapon aligned with the body needs
   * the same half turn before it is handed to the bone.
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
const HAND_BONE = 'hand_r';
const SPINE = ['spine_03', 'spine_02'];

export class SkinnedActor {
  /** @param {object} outfit the same outfit record the procedural rig takes */
  constructor(outfit) {
    this.o = outfit;
    this.root = new THREE.Group();
    this.deadBlend = 0;
    this._cur = null;
    this._hitUntil = 0;

    /*
     * SkeletonUtils.clone, not Object3D.clone. A plain clone copies the meshes
     * and the bones but leaves every SkinnedMesh bound to the *original*
     * skeleton, so every character in the level animates as one body. This is
     * the single easiest way to get skinned instancing wrong.
     */
    const body = cloneSkinned(SOURCE.body);
    body.rotation.y = Math.PI;          // the pack faces +Z; the game faces -Z
    this.root.add(body);
    this.body = body;

    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;          // self-shadowing on a 14k body is noise
      o.frustumCulled = false;          // skinned bounds go stale as it moves
      o.material = this._skin(o.material);
    });

    /*
     * The pack is a bare body — six anatomies and no clothes, and there is no
     * CC0 outfit set that shares this skeleton. `dress` cuts the clothing out
     * of the body itself so it inherits the skin weights; see outfit.js.
     */
    this.worn = dress(body, outfit);

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
    } else {
      this.rightHand = body;
    }
    // the mount is already oriented; the legacy pose is for the capsule rig
    this.weaponPose = { position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0) };

    this.mixer = new THREE.AnimationMixer(body);
    this._actions = new Map();
    this._play(LOCO.idle, 0);
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
       * Play locomotion at the speed the body is actually moving. A walk cycle
       * running at its authored rate under a character travelling at 5 m/s is
       * the classic ice-skating tell, and it is the thing that makes canned
       * animation read as canned.
       */
      const a = this._cur && this._actions.get(this._cur);
      if (a) {
        const ref = this._cur === LOCO.sprint ? 6.4 : this._cur === LOCO.jog ? 3.8 : 1.7;
        a.timeScale = moving ? clamp(speed / ref, 0.55, 1.7) : 1;
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
      spine.rotation.x += clamp(s.pitch ?? 0, -0.9, 0.9) * 0.55;
    }
  }

  faceYaw(yaw, dt, rate = 12) {
    this.root.rotation.y += angleDelta(this.root.rotation.y, yaw) * (1 - Math.exp(-rate * dt));
  }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }

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
