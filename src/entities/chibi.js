import * as THREE from 'three';

/**
 * ══════════════════════════════════════════════════════════════════
 *  CHIBI — the stylised build
 * ══════════════════════════════════════════════════════════════════
 *
 * Brawl Stars characters are roughly four heads tall. Real people are seven
 * and a half, and so are the models this game is built on. That single ratio
 * is most of the difference between the two looks — more than the palette,
 * more than the lighting — because it is what the eye reads first and from
 * furthest away.
 *
 * There is no remodelling here. The proportions are a scale per bone, so the
 * existing meshes, the existing skin weights and all forty-three animation
 * clips keep working untouched.
 *
 * ── why this is harder than setting bone.scale ──
 *
 * Every clip in the library carries position, quaternion AND scale tracks for
 * all sixty-five bones — 2795 tracks of each kind across the set. The mixer
 * writes all three every frame, so a scale assigned to a bone at load time
 * survives exactly until the first update and is then overwritten with the
 * pack's own 1.0. Anything that changes the build has to change the clips.
 *
 * So the factors are multiplied into the clips' scale tracks once, at load,
 * and into the rest pose as well for the frames before a clip is playing.
 *
 * ── why the table is in world scale ──
 *
 * Bone scale is hierarchical: scaling the forearm scales the hand, the
 * fingers and whatever is in them. Authoring local factors therefore means
 * doing the division in your head for every bone and redoing it whenever one
 * changes, which is how you end up with a character with one enormous thumb.
 * The table below states what each bone should end up as *in world terms*,
 * and the local factor each bone actually receives is derived from its
 * parent's — so "hands at 1.3" means hands at 1.3 regardless of what the arm
 * above them is doing.
 */

/**
 * Target world scale per bone family, against the pack's own build of 1.0.
 *
 * Read it as a silhouette: short thick legs, a compact torso, short arms with
 * big hands on the end, a very short neck and a head about twice the size it
 * has any business being.
 */
export const BUILD = {
  pelvis:   0.96,
  spine_01: 1.02,
  spine_02: 1.04,
  spine_03: 1.06,   // barrel chest, widening upward
  neck_01:  0.55,   // almost no neck — the head sits straight on the shoulders
  Head:     1.92,

  clavicle: 1.00,
  upperarm: 0.88,
  lowerarm: 0.80,
  hand:     0.80,   // == lowerarm, deliberately. See below.

  thigh:    0.86,
  calf:     0.78,
  foot:     0.78,   // == calf
  ball:     0.78,   // == foot
};

/*
 * ══════════════════════════════════════════════════════════════════
 *  Why the hands and feet are not bigger — an asset constraint
 * ══════════════════════════════════════════════════════════════════
 *
 * Oversized hands and boots belong in this register, and the first table had
 * them: hands at 1.30 world, feet at 1.15. Against arms and legs shortened
 * underneath them that works out to *local* factors of 1.86 and 1.64. On the
 * base body and on the crew it looked exactly right.
 *
 * On the armoured police it detonated. The squad rendered as a heap of blue
 * filling the sky, and it took an embarrassing while to recognise it as the
 * characters rather than as level geometry.
 *
 * ── the mechanism ──
 *
 * Skinning evaluates `bone.matrixWorld · boneInverse`, where boneInverse
 * records the pose the mesh was bound in. The police body was re-bound onto
 * this skeleton by `tools/rebind-character.py`, and a weight transfer leaves
 * a small residual: bind pose B and rest pose R are close but not equal.
 *
 * At scale 1 that residual is invisible, because the four residuals blended
 * across a vertex's weights sum back to something very near identity. Put a
 * scale S on the bone and the product becomes R·S·B⁻¹ instead of R·S·R⁻¹ —
 * the part of R·B⁻¹ that is not identity is now *multiplied* by S, and the
 * blend no longer cancels. Error that was a millimetre becomes a metre.
 *
 * This was established by elimination, not by guessing: every bone's animated
 * scale was measured against its expected factor and matched to four decimal
 * places on the broken body, and the crew — same skeleton, same clips, same
 * numbers — renders correctly. Identical skeleton, different mesh binding.
 *
 * The extremities are where a transferred weighting is least exact, which is
 * why hands and feet broke at local 1.4 while the head survived 3.49.
 *
 * ── what is done about it ──
 *
 * Recomputing the bind pose from the rest pose at load was tried and is
 * worse: these meshes genuinely are authored in a different pose from the
 * one they load in, so forcing the two together shreds every character
 * including the ones that worked.
 *
 * So the hands and feet take their parent's scale exactly — local factor 1,
 * nothing to amplify. The cost is real and visible: the build has a big head
 * and short limbs but ordinary hands, where the reference has shovels.
 *
 * The proper fix is offline — re-export the police body with its bind pose
 * baked into the mesh, at which point `hand` and `foot` can go back to 1.30
 * and 1.15 and the whole silhouette lands. `npm run proportions` asserts the
 * ceiling so that raising them without doing that work fails a check rather
 * than shipping.
 */
export const MAX_EXTREMITY_LOCAL = 1.02;

/** `thigh_l` → `thigh`, `index_02_r` → `index`, `Head` → `Head`. */
function family(name) {
  return name.replace(/_(l|r)$/, '').replace(/_\d+$/, '').replace(/_leaf$/, '');
}

/**
 * Work out the local scale each bone needs to land on its world target.
 *
 * `traverse` is depth-first pre-order, so a parent is always resolved before
 * its children and one pass is enough.
 */
export function localFactors(root, build = BUILD) {
  const world = new Map();
  const local = new Map();
  root.traverse((o) => {
    if (!o.isBone) return;
    const parent = world.get(o.parent?.name) ?? 1;
    const want = build[family(o.name)] ?? build[o.name] ?? parent;
    world.set(o.name, want);
    local.set(o.name, want / parent);
  });
  return { world, local };
}

/**
 * Restyle a rig and its clips in place.
 *
 * Idempotent — the clips are shared across every character in the game and
 * running this twice would square every factor.
 *
 * @param root   the shared source body (a SkinnedMesh hierarchy)
 * @param clips  every clip that will ever drive it
 * @returns the local factor table, for anything that needs to compensate
 */
export function chibify(root, clips, build = BUILD) {
  /*
   * An opt-out, for comparing against the realistic build without editing
   * the table to all ones and back. `?realistic` on the URL, or the global,
   * before assets load.
   */
  if (globalThis.__noChibi) return null;
  if (root.userData.chibi) return root.userData.chibi;
  if (globalThis.__chibiOnly) {
    const keep = new Set(globalThis.__chibiOnly);
    build = Object.fromEntries(Object.entries(build).map(([k, v]) => [k, keep.has(k) ? v : 1]));
  }

  const { local } = localFactors(root, build);

  /* the rest pose, for the frames before a clip is playing */
  root.traverse((o) => {
    if (o.isBone) o.scale.multiplyScalar(local.get(o.name) ?? 1);
  });

  /*
   * And the clips. Multiplied rather than assigned, so a clip that genuinely
   * animates a bone's scale keeps doing so on top of the new build.
   */
  for (const clip of clips) {
    if (clip.userData?.chibi) continue;
    for (const track of clip.tracks) {
      if (!track.name.endsWith('.scale')) continue;
      const f = local.get(track.name.slice(0, -6));
      if (!f || f === 1) continue;
      const v = track.values;
      for (let i = 0; i < v.length; i++) v[i] *= f;
    }
    (clip.userData ??= {}).chibi = true;
  }

  root.userData.chibi = local;
  return local;
}

/**
 * How tall the thing actually came out, and in how many heads.
 *
 * Not decoration: the collision capsule, the camera height and the head
 * hitbox are all written against a 1.82 m figure, and a build table is a
 * bundle of guesses until something measures what it produced. Called by
 * `npm run proportions`.
 */
export function measure(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const height = box.max.y - box.min.y;

  const head = root.getObjectByName('Head');
  const neck = root.getObjectByName('neck_01');
  let headTop = box.max.y, chin = null;
  if (head) {
    /*
     * The chin, approximated as the head bone's own origin — on this rig it
     * sits at the base of the skull, which is close enough for a ratio and
     * does not require guessing at vertex groups.
     */
    chin = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y;
  }
  const headLen = chin != null ? headTop - chin : null;
  return {
    height: +height.toFixed(3),
    headLength: headLen != null ? +headLen.toFixed(3) : null,
    heads: headLen ? +(height / headLen).toFixed(2) : null,
    neckY: neck ? +new THREE.Vector3().setFromMatrixPosition(neck.matrixWorld).y.toFixed(3) : null,
  };
}
