"""
Re-bind a supplied character onto the game's own skeleton.

    blender -b --python tools/rebind-character.py -- <in.fbx> <texdir> <out.glb>

A supplied character arrives with the rigger's skeleton, and that is the one
thing about it that cannot be used. The game's animation library — every walk,
sprint, crouch, reload and death in it, plus the measured weapon grip — is
authored against a 65-bone Unreal-convention rig, and this model came with a
129-bone Rigify one: different names, different hierarchy, different rest pose.
Nothing plays on it.

Retargeting the animations onto the new skeleton is the option that sounds
right and is the expensive, fragile one — a hundred and twenty-nine bones, and
every bone-roll difference shows up as a wrist that twists the wrong way three
clips later. Re-binding the *mesh* onto the skeleton that already works is the
cheap, robust one, and it is what this does.

Two shapes of input, and the second is the harder one:

  · **The model came rigged** (in someone else's convention). Its own skeleton
    is used once, to pose it into the game rig's T-pose, and then discarded.

  · **The model came with no skeleton at all.** Then it cannot be posed, so the
    whole thing runs backwards: read the model's A-pose off its silhouette,
    pose the *game* rig to match, transfer weights between two figures now
    standing the same way, and finally un-skin the mesh — invert the skinning
    matrix each vertex has just acquired — to lift it out of the A-pose and
    into the rig's rest pose. The output is the same in both cases: a T-posed
    mesh bound to the game's own untouched skeleton.

The rigged path, step by step:

  1. **T-pose the supplied mesh, onto the game rig's own T-pose.** It is
     modelled in an A-pose. Each arm is rotated at the shoulder so it points at
     where the game rig's hand actually is, then at the elbow so the forearm
     carries on along the same line — computed from both rigs' bone positions,
     not typed in. Aiming at a flat ±X instead is the obvious version and it
     leaves the arms twelve centimetres below the donor's, which is enough for
     a forearm to pick up the weights of the ribcage beside it.

  2. **Bake it.** The armature modifier is applied, so the T-pose becomes the
     mesh's actual geometry and the supplied skeleton can be thrown away.

  3. **Transfer the weights.** Every vertex takes its bone weights from the
     nearest point on the game body's surface. Both meshes are now in the same
     pose in the same place, which is the only condition that makes a nearest-
     surface transfer meaningful — do this in mismatched poses and a shoulder
     pauldron picks up the weights of whatever happens to be beside it.

  4. **Bind to the game armature**, and export.

The rest pose therefore stays exactly the game's own, which matters more than
it looks: three.js writes a clip's bone tracks straight onto the bones as
absolute local transforms, so a bone no clip touches keeps its *rest* value. A
model bound to a rig resting in some other pose looks correct until the one
clip that leaves the fingers alone.
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, TEXDIR, OUT = argv[0], argv[1], argv[2]
BODY = os.path.join(os.path.dirname(__file__), '..', 'assets', 'models', 'people', 'body.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)


def only(kind, among=None):
    xs = [o for o in (among or bpy.data.objects) if o.type == kind]
    return xs[0] if xs else None


# ── the supplied character ──────────────────────────────────────────
# `--drop` removes meshes by name before anything else. Character scans arrive
# with a full mouth interior — teeth, gums, tongue, corneas — which on this one
# is seventeen thousand triangles of geometry that is never once visible from
# behind a third-person camera.
DROP = set()
for a in argv[3:]:
    if a.startswith('--drop='):
        DROP |= {s for s in a[7:].split(',') if s}

"""
GLB in as readily as FBX.

The two formats need different importers and nothing downstream cares which
one ran. GLB is the better thing to be handed — one file, textures inside it,
no external paths to fail to resolve, and none of FBX's unit-scale games — so
it should not be the one that needs converting first.
"""
if SRC.lower().endswith(('.glb', '.gltf')):
    bpy.ops.import_scene.gltf(filepath=SRC)
else:
    bpy.ops.import_scene.fbx(filepath=SRC)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name in DROP:
        bpy.data.objects.remove(o, do_unlink=True)

src_objs = list(bpy.data.objects)
src_arm = only('ARMATURE', src_objs)
meshes = [o for o in src_objs if o.type == 'MESH']

# One mesh from here on. A supplied character is often a dozen objects — body,
# shirt, shorts, sandals, eyes — and every step below (posing, weight transfer,
# un-skinning, binding) would otherwise have to be written for a list.
bpy.ops.object.select_all(action='DESELECT')
src_mesh = max(meshes, key=lambda o: len(o.data.vertices))
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = src_mesh
if len(meshes) > 1:
    bpy.ops.object.join()
src_mesh = bpy.context.view_layer.objects.active
bpy.context.view_layer.update()
print('SUPPLIED', src_mesh.name, len(src_mesh.data.vertices), 'verts from',
      len(meshes), 'objects,',
      f'{len(src_arm.data.bones)} bones' if src_arm else 'no armature')

"""
Stand the model up if it came in lying down.

The FBX format records its own up axis and exporters disagree about it, so two
supplied characters in the same project arrive in different orientations —
one Z-up and correct, the next Y-up and face-down. A person is much taller than
they are deep, so the tallest axis is the one that should be up, and that is a
safer test than trusting the file. Getting it wrong is not subtle downstream:
the height match scaled this model by 11.76 instead of 2.16, because it
measured a lying-down body's depth as its height.

The measurement is of the *world* box, and that distinction is the whole trap.
`Object.dimensions` is the local bounding box times scale with the object's
rotation thrown away — and the FBX importer expresses its own up-axis fix as
exactly that rotation. So a model already standing correctly reports local
dimensions that say it is lying down, and a test on `dimensions` turns the one
model that was right onto its face.
"""


def world_extent(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector((max(c[i] for c in cs) - min(c[i] for c in cs) for i in range(3)))


if not src_arm:
    d = world_extent(src_mesh)
    print('EXTENT', tuple(round(v, 3) for v in d))
    if d.y > d.z * 1.5:
        src_mesh.matrix_world = Matrix.Rotation(math.pi / 2, 4, 'X') @ src_mesh.matrix_world
        bpy.ops.object.transform_apply(rotation=True)
        bpy.context.view_layer.update()
        print(f'STOOD UP from Y-up: {tuple(round(v, 3) for v in world_extent(src_mesh))}')


def abone(name):
    b = src_arm.data.bones.get(name)
    return src_arm.matrix_world @ b.head_local if b else None


def rotate_pose(pbone, pivot, frm, to):
    """Turn a pose bone about `pivot` so `frm` ends up pointing along `to`."""
    frm, to = frm.normalized(), to.normalized()
    axis = frm.cross(to)
    if axis.length < 1e-6:
        return
    q = Quaternion(axis.normalized(), frm.angle(to))
    m = (Matrix.Translation(pivot) @ q.to_matrix().to_4x4()
         @ Matrix.Translation(-pivot))
    pbone.matrix = m @ pbone.matrix
    bpy.context.view_layer.update()


# where the game rig keeps its hands, read out of the game body itself
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.normpath(BODY))
added = [o for o in bpy.data.objects if o not in before]
arm = only('ARMATURE', added)
body = max((o for o in added if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
TARGET = {s: arm.matrix_world @ arm.data.bones[f'hand_{s.lower()}'].head_local
          for s in ('L', 'R')}
print('GAME RIG', len(arm.data.bones), 'bones; donor', body.name,
      len(body.data.vertices), 'verts; hands', {k: tuple(round(c, 3) for c in v)
                                                for k, v in TARGET.items()})

if src_arm:
    bpy.context.view_layer.objects.active = src_arm
    bpy.ops.object.mode_set(mode='POSE')
    for side in ('L', 'R'):
        shoulder, hand = abone(f'DEF-upper_arm.{side}'), abone(f'DEF-hand.{side}')
        if not shoulder or not hand:
            continue
        out = TARGET[side] - shoulder
        rotate_pose(src_arm.pose.bones[f'DEF-upper_arm.{side}'], shoulder, hand - shoulder, out)
        # re-read: the shoulder turn moved everything below it
        elbow = src_arm.matrix_world @ src_arm.pose.bones[f'DEF-forearm.{side}'].head
        hand = src_arm.matrix_world @ src_arm.pose.bones[f'DEF-hand.{side}'].head
        rotate_pose(src_arm.pose.bones[f'DEF-forearm.{side}'], elbow, hand - elbow,
                    TARGET[side] - elbow)
        hand = src_arm.matrix_world @ src_arm.pose.bones[f'DEF-hand.{side}'].head
        print(f'T-POSE {side} hand -> {tuple(round(v, 3) for v in hand)}')
    bpy.ops.object.mode_set(mode='OBJECT')

    # bake the pose into the geometry, then the supplied rig has done its job
    bpy.context.view_layer.objects.active = src_mesh
    for mod in list(src_mesh.modifiers):
        if mod.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=mod.name)
    src_mesh.vertex_groups.clear()
    src_mesh.parent = None
    src_mesh.matrix_world = Matrix.Identity(4)

# ── onto the game's skeleton ────────────────────────────────────────
'''
Flatten first, then measure, then scale, then flatten again.

Order matters, and getting it wrong cost an afternoon. The FBX importer leaves
a scale on the object — 0.01 here, because the file is authored in centimetres
— so its vertex data is a hundred times its real size and only the object
transform brings it back. Assigning `object.scale = k` in that state does not
scale the model by k, it *replaces* the 0.01 and blows the mesh up by a factor
of a hundred. The result still measured 1.82 m in Blender, because every
measurement went through the object transform too, and only surfaced as a wall
of yellow filling the screen once it was in the game.

Applying the transform up front puts the vertices in real units with an
identity object matrix, which makes the scale multiplication unambiguous and
also gives the un-skinning below the one thing it needs: mesh space and
armature space being the same space.
'''
bpy.ops.object.select_all(action='DESELECT')
src_mesh.select_set(True)
bpy.context.view_layer.objects.active = src_mesh
# Unparent first, keeping the world transform. `transform_apply` bakes an
# object's *own* matrix and nothing above it, and this FBX parents every mesh
# to an empty — one per group, under a root empty holding the file's centimetre
# unit scale. Applying the transform left the 0.01 sitting on the parent,
# untouched and invisible to every check, because `matrix_world` still
# reported the right answer.
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()

sz, bz = world_extent(src_mesh).z, world_extent(body).z
if sz > 0 and abs(sz - bz) / bz > 0.01:
    k = bz / sz
    src_mesh.scale = (k, k, k)
    bpy.ops.object.transform_apply(scale=True)
    bpy.context.view_layer.update()
    print(f'SCALED supplied mesh by {k:.4f} to match {bz:.3f} m'
          f' → {tuple(round(v, 3) for v in world_extent(src_mesh))}')

"""
── the unrigged case ───────────────────────────────────────────────

A model with no skeleton cannot be posed into the game rig's T-pose, so the
T-posing above has nothing to work with. It is still bindable, by running the
whole thing backwards:

  1. Read the model's own pose *off its silhouette*. In an A-pose the widest
     point of the body between the hip and the chest is the hand, so the
     outermost vertex in that band gives the direction the arm hangs in. No
     bones needed, and nothing typed in.

  2. Pose the **game rig** into that A-pose, and bake a copy of the game body
     with it. Now the donor and the supplied mesh are standing the same way.

  3. Transfer the weights between them, exactly as in the rigged case.

  4. **Un-skin the mesh.** Every vertex now knows which bones move it, so the
     skinning matrix at the A-pose can be built for it and inverted, which maps
     the mesh back out of the A-pose and into the rig's rest pose. That is what
     makes this safe: the exported model is a genuine T-posed mesh bound to the
     game's own untouched rest pose, identical in kind to every other body in
     the game, rather than something that only looks right until a clip fails
     to touch some bone.
"""
"""
`--arm=<down>,<forward>` states the pose instead of guessing it.

The silhouette read below assumes an A-pose: in one, the widest point of the
body between hip and chest really is the hand, so the outermost vertex gives
the direction the arm hangs in, and nothing has to be typed.

Plenty of models are not in an A-pose. BitGem's police officer ships as
`cop_pose.fbx` and is exactly what that name says — a posed idle, upper arms
hanging against the body and both elbows bent forward, holding a donut. The
widest point in that band is his belt. The read came back asymmetric and
nonsense (one "hand" at hip height on one side, mid-chest on the other), the
transfer sampled the torso for both arms, and he exported with two flat
sheets of geometry where his arms should be.

So: two angles, in degrees, and a model that is not in an A-pose stops being
a problem to be detected and becomes a parameter.

    down     how far the upper arms are rotated from horizontal toward the
             floor. 0 is a T-pose, 90 is arms flat against the sides.
    forward  how far the forearms are then bent toward the front.

Both are read off the model by eye in two or three iterations, which is
faster and more honest than a cleverer heuristic that will fail differently
on the next model.
"""
"""
`--donor=chibi` reshapes the donor with the game's own stylised build.

These are the *local* bone factors that `src/entities/chibi.js` derives from
its world-scale table — they have to agree, because the whole point is that
the transfer samples a donor shaped like the character the game will
actually draw. There is no clean way to import a JS table into Blender, so
they are duplicated here and `npm run proportions` prints the runtime side
for comparison.
"""
CHIBI_LOCAL = {
    'pelvis': 0.96, 'spine_01': 1.0625, 'spine_02': 1.0196, 'spine_03': 1.0192,
    'neck_01': 0.5189, 'Head': 3.4909,
    **{f'{b}_{s}': v for s in 'lr' for b, v in (
        ('clavicle', 0.9434), ('upperarm', 1.0000), ('lowerarm', 0.9500),
        ('thigh', 0.8542), ('calf', 0.9024))},
}

ARM = None
DONOR = None
HEADCUT = 0.0
DESPIKE = 0.0
KEEPMAT = False
for a in argv[3:]:
    if a.startswith('--arm='):
        ARM = [math.radians(float(x)) for x in a[6:].split(',')]
    if a.startswith('--donor='):
        DONOR = a[8:].split(',')
    if a.startswith('--headcut='):
        HEADCUT = float(a[10:])
    if a.startswith('--despike='):
        DESPIKE = float(a[10:])
    if a == '--keepmat':
        KEEPMAT = True

UNRIGGED = src_arm is None
if UNRIGGED:
    # Blender is Z-up and the glTF importer maps three's forward (+Z) onto −Y,
    # so "forward" for the elbow bend is −Y and "down" is −Z.
    FWD = Vector((0, -1, 0))

    reach = None
    if ARM is None:
        pts = [src_mesh.matrix_world @ v.co for v in src_mesh.data.vertices]
        lo = min(p.z for p in pts)
        hi = max(p.z for p in pts)
        band = [p for p in pts if lo + (hi - lo) * 0.32 <= p.z <= lo + (hi - lo) * 0.62]
        reach = {
            'L': max(band, key=lambda p: p.x),
            'R': min(band, key=lambda p: p.x),
        }
        print('A-POSE read from the silhouette:',
              {k: tuple(round(c, 3) for c in v) for k, v in reach.items()})
    else:
        print('A-POSE given: down %.0f°, forward %.0f°'
              % (math.degrees(ARM[0]), math.degrees(ARM[1])))

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')

    """
    `--donor=<head>,<limb>` reshapes the donor before the transfer.

    The weight transfer works by nearest point on the donor's surface, and
    that is only meaningful if the two figures are the same *shape*, not just
    the same pose. The donor here is a realistic seven-and-a-half-heads
    human. BitGem's police officer is about three and a half — his head
    occupies exactly the volume where the donor's shoulders and upper arms
    are, so every vertex in his face found the donor's arm as its nearest
    surface, took arm weights, and the export had a head that fanned out
    sideways into two flat sheets the moment anything moved.

    Scaling the donor's bones to roughly the supplied model's proportions
    fixes it at the source. The scale is applied *before* the arms are posed,
    so the arm targets are measured on the reshaped skeleton, and it is
    removed again before the un-skin — the supplied mesh arrived with its own
    proportions and must keep them, so only the pose is undone.
    """
    if DONOR:
        shaped = dict(CHIBI_LOCAL) if DONOR == ['chibi'] else {
            'Head': float(DONOR[0]), 'neck_01': 0.52,
            **{f'{b}_{s}': float(DONOR[1] if len(DONOR) > 1 else 1.0)
               for s in 'lr' for b in ('upperarm', 'lowerarm', 'thigh', 'calf')},
        }
        for name, sc in shaped.items():
            pb = arm.pose.bones.get(name)
            if pb:
                pb.scale = (sc, sc, sc)
        bpy.context.view_layer.update()
        print('DONOR reshaped:', {k: round(v, 3) for k, v in sorted(shaped.items())})

    for side in ('L', 'R'):
        s = side.lower()
        shoulder = arm.matrix_world @ arm.data.bones[f'upperarm_{s}'].head_local
        hand = arm.matrix_world @ arm.data.bones[f'hand_{s}'].head_local
        tip = arm.matrix_world @ arm.data.bones[f'middle_03_{s}'].tail_local

        if ARM is not None:
            # two values are symmetric; four give each arm its own pose, which
            # Redford needs — one hand is up by his face and the other is down
            # at his hip holding a donut, and a symmetric guess mangles one of
            # them whichever way round it is set.
            if len(ARM) >= 4:
                down, fwd = (ARM[0], ARM[1]) if side == 'L' else (ARM[2], ARM[3])
            else:
                down, fwd = ARM[0], (ARM[1] if len(ARM) > 1 else 0.0)
            sign = 1.0 if side == 'L' else -1.0
            upper = Vector((sign * math.cos(down), 0.0, -math.sin(down)))
            rotate_pose(arm.pose.bones[f'upperarm_{s}'], shoulder,
                        hand - shoulder, upper)
            if fwd:
                # bend at the elbow about the axis perpendicular to the arm and
                # to forward, so the forearm swings ahead rather than twisting
                elbow = arm.matrix_world @ arm.pose.bones[f'lowerarm_{s}'].head
                wrist = arm.matrix_world @ arm.pose.bones[f'hand_{s}'].head
                axis = upper.cross(FWD)
                if axis.length > 1e-6:
                    target = Quaternion(axis.normalized(), fwd) @ upper
                    rotate_pose(arm.pose.bones[f'lowerarm_{s}'], elbow,
                                wrist - elbow, target)
            continue

        # Aim at the *wrist*, not the fingertip. The silhouette gives the
        # outermost point of the arm, which is the end of the fingers; pointing
        # the rig's hand bone there parks it halfway down the model's forearm,
        # and everything past it becomes rigid geometry hanging off `hand_r` —
        # long stiff arms with the fingers splayed through every animation. The
        # rig knows its own proportions, so the correction is read from it.
        along = (hand - shoulder).length / max((tip - shoulder).length, 1e-6)
        target = shoulder + (reach[side] - shoulder) * along
        rotate_pose(arm.pose.bones[f'upperarm_{s}'], shoulder,
                    hand - shoulder, target - shoulder)
    bpy.ops.object.mode_set(mode='OBJECT')

    # a donor frozen in that pose, for the transfer to sample
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    posed = bpy.context.view_layer.objects.active
    for mod in list(posed.modifiers):
        if mod.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=mod.name)
    posed.parent = None
    body_for_transfer = posed
else:
    body_for_transfer = body

# ── weights ─────────────────────────────────────────────────────────
# Donor active, recipient selected — the operator's own direction.
# Its `use_reverse_transfer` flag looks like the tidier way to say this and
# cannot be used from Python: reversing swaps the two layer-select values
# internally, and 'ALL' is not in the destination property's enum, so the call
# is rejected before it runs.
bpy.ops.object.select_all(action='DESELECT')
src_mesh.select_set(True)
body_for_transfer.select_set(True)
bpy.context.view_layer.objects.active = body_for_transfer
bpy.ops.object.data_transfer(
    data_type='VGROUP_WEIGHTS', use_create=True,
    vert_mapping='POLYINTERP_NEAREST',
    layers_select_src='ALL', layers_select_dst='NAME',
    mix_mode='REPLACE')
print('WEIGHTS transferred:', len(src_mesh.vertex_groups), 'groups')

if UNRIGGED:
    # Un-skin: undo the A-pose on the mesh, using the weights it just gained.
    # Each vertex's skinning matrix at the current pose is built and inverted,
    # which is exactly the map from posed space back to rest space.
    """
    The donor's reshaping stays on through the un-skin, deliberately.

    This is the decision that makes stylised models work at all in a game
    with one shared skeleton, and it is worth stating plainly.

    A supplied character has whatever proportions its artist gave it. The
    police officer is about three and a half heads tall; the game's rig is
    seven and a half. Bind the first to the second and the un-skin drops his
    hand vertices onto the rig's hand bones, which are twice as far out as
    his arms are long — his forearms stretch into two flat sheets and his
    face fans out sideways with them. That is not a bug in the transfer, it
    is two figures that are not the same animal.

    So every supplied body is normalised onto the *realistic* rig here, and
    the stylised proportions come back at runtime from a single table in
    `src/entities/chibi.js`. One place decides what the cast looks like,
    every body agrees with every other, and a model authored at any
    proportion can be dropped in. The cost is that the artist's exact build
    is not preserved — Redford comes out with the game's head-to-body ratio
    rather than his own.
    """
    """
    Take the arms off the head.

    A nearest-surface transfer has no idea what a head is. On a stylised
    character the head is enormous and the neck is barely there, so the jaw
    and cheeks hang down *beside* the donor's shoulders and the nearest
    polygon to them is an upper arm. Forty-six per cent of this model's head
    vertices came back weighted to an arm, and enlarging the donor's head to
    five times life size moved that number by four — the overlap is
    geometric, not a matter of the donor being too small.

    So it is corrected rather than avoided. Above the cut line nothing may be
    driven by an arm: those weights are removed and what remains is
    renormalised, and a vertex left with nothing at all is given to the head
    outright. Below the cut line nothing is touched.

    On a normally proportioned model this is a no-op, because vertices above
    the neck already belong to the head.
    """
    if HEADCUT:
        zs = [v.co.z for v in src_mesh.data.vertices]
        cut = min(zs) + (max(zs) - min(zs)) * HEADCUT
        band = cut - (max(zs) - min(zs)) * 0.07     # the ramp below the line

        def clamp01(x):
            return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)
        gname = {g.index: g.name for g in src_mesh.vertex_groups}
        arms = {i for i, n in gname.items()
                if n.startswith(('upperarm', 'lowerarm', 'hand', 'clavicle'))
                or n.split('_')[0] in ('index', 'middle', 'ring', 'pinky', 'thumb')}
        head_g = src_mesh.vertex_groups.get('Head')
        fixed = 0
        for v in src_mesh.data.vertices:
            if v.co.z < band:
                continue
            """
            Read the whole vertex first, then edit it.

            `v.groups` is a live collection and `VertexGroupElement` is a
            reference into it, so removing one entry invalidates the others —
            reading `.group` or `.weight` off a sibling afterwards returns
            whatever is now at that slot. Iterating and removing in the same
            pass therefore silently rewrites the wrong weights, which on this
            model put several hundred hood vertices onto bones they had no
            business being on and blew the un-skin out to five metres.

            Plain integers and floats copied out up front cannot go stale.
            """
            owned = [(g.group, g.weight) for g in v.groups if g.weight > 0]
            """
            Above the line the head is one rigid lump.

            Stripping the arm weights and renormalising what was left sounded
            more careful and was worse: a police cap came back shredded into
            vertical strips, because its vertices had been sharing themselves
            between the head and two bones that no longer applied, and
            whatever survived the strip did not describe a hat.

            A stylised character's head *is* rigid — there is no neck to
            speak of and nothing above the jaw deforms — so everything above
            the cut goes wholly to the head bone. The band just below it
            ramps, otherwise the jawline creases every time the character
            looks down.
            """
            fixed += 1
            for gi, _ in owned:
                src_mesh.vertex_groups[gname[gi]].remove([v.index])
            solid = clamp01((v.co.z - band) / max(cut - band, 1e-6))
            if head_g:
                head_g.add([v.index], solid, 'REPLACE')
            if solid < 1.0:
                rest = [(gname[gi], w) for gi, w in owned if gi not in arms]
                total = sum(w for _, w in rest) or 1.0
                for n, w in rest:
                    if n == 'Head':
                        continue
                    src_mesh.vertex_groups[n].add(
                        [v.index], (1.0 - solid) * w / total, 'REPLACE')
        print(f'HEAD CLEANED {fixed} vertices above {HEADCUT:.0%} height taken off the arms')

    # ── diagnostic: who owns the head? ──
    # A stylised model's head sits where a realistic donor's shoulders are, so
    # the failure mode of this whole step is head vertices taking arm weights
    # and fanning out along ±X the moment the rest pose is restored. Counting
    # it is the difference between "looks wrong" and knowing why.
    zs = [v.co.z for v in src_mesh.data.vertices]
    top = min(zs) + (max(zs) - min(zs)) * 0.78
    gname = {g.index: g.name for g in src_mesh.vertex_groups}
    bad = tot = 0
    for v in src_mesh.data.vertices:
        if v.co.z < top:
            continue
        tot += 1
        if any(g.weight > 0.3 and gname.get(g.group, '').startswith(
                ('upperarm', 'lowerarm', 'hand', 'clavicle')) for g in v.groups):
            bad += 1
    print(f'HEAD CHECK {bad}/{tot} vertices above 78% height are weighted to an arm')

    names = [g.name for g in src_mesh.vertex_groups]
    delta = {}
    for n in names:
        pb = arm.pose.bones.get(n)
        db = arm.data.bones.get(n)
        if pb and db:
            delta[src_mesh.vertex_groups[n].index] = pb.matrix @ db.matrix_local.inverted()

    moved = 0
    for v in src_mesh.data.vertices:
        acc, total = Matrix(((0,) * 4,) * 4), 0.0
        for g in v.groups:
            d = delta.get(g.group)
            if d is None or g.weight <= 0:
                continue
            for r in range(4):
                for c in range(4):
                    acc[r][c] += d[r][c] * g.weight
            total += g.weight
        if total < 1e-6:
            continue
        for r in range(4):
            for c in range(4):
                acc[r][c] /= total
        try:
            v.co = acc.inverted() @ v.co
            moved += 1
        except ValueError:
            pass                    # a degenerate blend; leave the vertex alone
    """
    Pull in the vertices the un-skin threw away.

    Inverting a blended skinning matrix is exact for a vertex whose four
    weights describe it well, and badly conditioned for one whose weights are
    a compromise between two bones pointing in different directions. A
    handful of vertices at a shoulder or a jaw come out metres from where
    they belong, and because they are still connected to their neighbours the
    result is a long thin triangle — the spike out of this model's left
    shoulder that survived every arm angle tried against it.

    They are outliers in the strict sense: a vertex whose distance from the
    average of its own connected neighbours is many times the mesh's typical
    edge length is not a modelling choice, it is a numerical failure. Two
    passes of pulling only those back onto their neighbours' centroid removes
    them and leaves every well-conditioned vertex untouched.
    """
    if DESPIKE:
        import statistics
        edges = src_mesh.data.edges
        nbr = {}
        lens = []
        for e in edges:
            a, b = e.vertices
            nbr.setdefault(a, []).append(b)
            nbr.setdefault(b, []).append(a)
            lens.append((src_mesh.data.vertices[a].co
                         - src_mesh.data.vertices[b].co).length)
        typical = statistics.median(lens) if lens else 0.0
        limit = typical * DESPIKE
        pulled = 0
        for _ in range(2):
            for i, ns in nbr.items():
                if not ns:
                    continue
                v = src_mesh.data.vertices[i]
                mid = Vector((0, 0, 0))
                for n in ns:
                    mid += src_mesh.data.vertices[n].co
                mid /= len(ns)
                if (v.co - mid).length > limit:
                    v.co = mid
                    pulled += 1
        src_mesh.data.update()
        print(f'DESPIKED {pulled} vertices further than {limit:.3f} m '
              f'({DESPIKE}× the median edge) from their neighbours')

    src_mesh.data.update()
    print(f'UN-SKINNED {moved}/{len(src_mesh.data.vertices)} vertices back to the rest pose')

    bpy.data.objects.remove(body_for_transfer, do_unlink=True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode='OBJECT')

src_mesh.parent = arm
src_mesh.matrix_parent_inverse = arm.matrix_world.inverted()
m = src_mesh.modifiers.new('Armature', 'ARMATURE')
m.object = arm

# ── materials ───────────────────────────────────────────────────────
# The FBX points at the rigger's own disk, so every image datablock arrives
# empty and the maps have to be found in the folder that shipped beside it.
def find(*keys):
    for f in sorted(os.listdir(TEXDIR)):
        low = f.lower()
        if any(k in low for k in keys):
            return os.path.join(TEXDIR, f)
    return None


def build(name, maps):
    """One Principled material from a {socket: path} set."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for socket, (path, non_color) in maps.items():
        if not path:
            print('  no map for', name, socket)
            continue
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(path)
        if non_color:
            tex.image.colorspace_settings.name = 'Non-Color'
        tex.image.pack()
        if socket == 'Normal':
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(nm.inputs['Color'], tex.outputs['Color'])
            nt.links.new(bsdf.inputs['Normal'], nm.outputs['Normal'])
        else:
            nt.links.new(bsdf.inputs[socket], tex.outputs['Color'])
    if 'Roughness' not in maps:
        bsdf.inputs['Roughness'].default_value = 0.72
    return mat


"""
`--tex=Material:Prefix,...` keeps the model's own material split.

Without it every slot collapses into one material, which is right for a model
that only has one and wrong for a character whose skin, clothing and eyes each
ship their own set — merging those puts the eye texture on the shirt. The
mapping has to be given rather than guessed, because "Body_Material" and
"T_VendormanBody_Diff" only look obviously related to a human.
"""
PER_MAT = {}
for a in argv[3:]:
    if a.startswith('--tex='):
        for pair in a[6:].split(','):
            k, _, v = pair.partition(':')
            if k and v:
                PER_MAT[k] = v

if PER_MAT:
    for slot, mat in enumerate(list(src_mesh.data.materials)):
        prefix = mat and PER_MAT.get(mat.name)
        if not prefix:
            continue
        src_mesh.data.materials[slot] = build(mat.name, {
            'Base Color': (find(f'{prefix}_diff'.lower(), f'{prefix}_albedo'.lower()), False),
            'Normal': (find(f'{prefix}_norm'.lower()), True),
            'Metallic': (find(f'{prefix}_metal'.lower()), True),
        })
        print('MATERIAL', mat.name, '<-', prefix)
"""
`--albedo=`, `--rough=`, `--metal=` name the maps outright.

The guesses below cover the naming conventions of the asset sites this
project pulls from, and they are guesses. BitGem's police officer ships its
base colour as `cop_blue.tga.png` — a perfectly reasonable name that contains
none of "albedo", "basecolor", "diffuse" or "_t_", so the automatic path
found nothing and bound an untextured grey man without complaining. A
substring given on the command line beats a heuristic that fails silently.
"""
NAMED = {}
for a in argv[3:]:
    for flag, socket in (('--albedo=', 'Base Color'), ('--rough=', 'Roughness'),
                         ('--metal=', 'Metallic'), ('--norm=', 'Normal')):
        if a.startswith(flag):
            NAMED[socket] = a[len(flag):]

if KEEPMAT:
    # The model already carries the material it should ship with — a baked
    # palette from `tools/palette-bake.py`, packed into the FBX. Rebuilding it
    # from files in a texture directory would throw that away and bind an
    # untextured figure.
    print('MATERIAL kept as authored:',
          [m.name if m else None for m in src_mesh.data.materials])
elif NAMED:
    src_mesh.data.materials.clear()
    src_mesh.data.materials.append(build('Rebound', {
        socket: (find(key.lower()), socket != 'Base Color')
        for socket, key in NAMED.items()
    }))
    print('MATERIAL from explicit names', NAMED)
elif not PER_MAT:
    src_mesh.data.materials.clear()
    src_mesh.data.materials.append(build('Rebound', {
        'Base Color': (find('_t_', 'albedo', 'basecolor', 'diffuse'), False),
        'Normal': (find('_n_', 'normal'), True),
        'Roughness': (find('_r_', 'rough'), True),
        'Metallic': (find('_m_', 'metal'), True),
    }))

# ── export ──────────────────────────────────────────────────────────
for o in list(bpy.data.objects):
    if o not in (src_mesh, arm) and o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE' and o is not arm:
        bpy.data.objects.remove(o, do_unlink=True)

# The one number worth printing at the end: a T-posed adult is about 1.8 m
# tall and about 2 m across. Anything else means a step above went wrong.
print('FINAL extent', tuple(round(v, 3) for v in world_extent(src_mesh)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=False,
                          export_yup=True, export_skins=True, export_materials='EXPORT',
                          export_image_format='AUTO')
src_mesh.data.calc_loop_triangles()
print('WROTE', OUT, os.path.getsize(OUT), len(src_mesh.data.loop_triangles), 'tris')
