import * as THREE from 'three';

/**
 * ══════════════════════════════════════════════════════════════════
 *  TWO-BONE IK — putting a hand where it needs to be
 * ══════════════════════════════════════════════════════════════════
 *
 * The animation library has one pair of hands and no idea what they are
 * holding. Every clip in it was authored against a pistol, so the left arm
 * swings free through all of them — which is fine for a pistol and wrong for
 * every other weapon in the game. A rifle held in one hand with the other arm
 * hanging at the side is the loudest possible signal that a character is
 * being animated rather than acting.
 *
 * This is the smallest thing that fixes it: an analytic two-bone solve that
 * puts the off hand on the weapon's foregrip after the mixer has run, every
 * frame, whatever clip is playing.
 *
 * ── the solve ──
 *
 * Two bones of fixed length L1 and L2 reaching from a shoulder S to a target
 * T form a triangle, and a triangle with three known sides has known angles.
 * No iteration, nothing to converge:
 *
 *   d  = |T − S|, clamped so the arm can neither hyperextend nor fold shut
 *   α  = the angle between the upper arm and the line S→T
 *        cos α = (L1² + d² − L2²) / (2·L1·d)
 *
 * The triangle can spin freely about S→T, so a **pole** decides which way the
 * elbow breaks. Without one the elbow lands wherever the previous frame's
 * numerical noise left it and the arm flickers inside out.
 *
 * ── why nothing here knows which way a bone points ──
 *
 * The obvious implementation builds a look-at basis and assigns it to the
 * bone, which requires knowing whether bones run along their local +X, +Y or
 * +Z. That varies by exporter, and getting it wrong does not throw — it
 * produces an arm that reaches confidently to a point forty centimetres from
 * the target, which is exactly what the first version of this file did.
 *
 * So no axis is ever named. Each bone's current direction is measured from
 * where it is to where its child is, and the rotation that carries that
 * direction onto the wanted one is applied on top of whatever the clip
 * already did. `setFromUnitVectors` cannot be wrong about a convention it
 * never has to know.
 */

const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _upper = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

/**
 * Turn `bone` so that the direction from it to `childPos` ends up along
 * `want`, without ever naming an axis.
 */
function aimAlong(bone, childPos, want) {
  bone.getWorldPosition(_cur);
  _cur.subVectors(childPos, _cur);
  if (_cur.lengthSq() < 1e-10) return;
  _cur.normalize();

  _q.setFromUnitVectors(_cur, want);
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(_q);                       // rotate in world space
  bone.parent.getWorldQuaternion(_pq).invert();
  bone.quaternion.copy(_pq.multiply(_wq));
  bone.updateMatrixWorld(true);              // children must follow before the next stage
}

/**
 * Reach `end` to `target` by rotating `root` and `mid`.
 *
 * @param root    upper bone (shoulder)
 * @param mid     lower bone (elbow)
 * @param end     the bone whose head should land on the target (wrist)
 * @param target  world position to reach
 * @param poleDir world-space direction the elbow should break toward
 * @param weight  0..1 blend against whatever the clip already did
 * @returns how far the end bone finished from the target, in metres
 */
export function solveTwoBone(root, mid, end, target, poleDir, weight = 1) {
  if (!root || !mid || !end || weight <= 0) return -1;

  root.getWorldPosition(_s);
  mid.getWorldPosition(_e);
  end.getWorldPosition(_w);

  const L1 = _s.distanceTo(_e);
  const L2 = _e.distanceTo(_w);
  if (L1 < 1e-5 || L2 < 1e-5) return -1;

  _t.copy(target);
  if (weight < 1) _t.lerp(_w, 1 - weight);

  _dir.subVectors(_t, _s);
  let d = _dir.length();
  if (d < 1e-5) return -1;
  _dir.divideScalar(d);
  // never fully straight and never folded shut — both are singular
  d = THREE.MathUtils.clamp(d, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);

  const cosA = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const alpha = Math.acos(cosA);

  /*
   * The pole, made perpendicular to the reach. Passing it in raw would let a
   * pole nearly parallel to the arm produce a zero-length cross product and
   * an arm that snaps to an arbitrary plane for a frame.
   */
  _pole.copy(poleDir).addScaledVector(_dir, -poleDir.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0).addScaledVector(_dir, -_dir.y * -1);
  _pole.normalize();
  _axis.crossVectors(_dir, _pole).normalize();

  // upper arm: the reach direction, swung off it by alpha in the pole's plane
  _upper.copy(_dir).applyAxisAngle(_axis, -alpha);
  aimAlong(root, _e, _upper);

  // forearm: from wherever the elbow ended up, straight at the target
  mid.getWorldPosition(_e);
  end.getWorldPosition(_w);
  aimAlong(mid, _w, _dir.subVectors(_t, _e).normalize());

  end.getWorldPosition(_w);
  return _w.distanceTo(_t);
}
