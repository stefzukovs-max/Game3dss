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
cheap, robust one, and it is what this does:

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
bpy.ops.import_scene.fbx(filepath=SRC)
src_objs = list(bpy.data.objects)
src_arm = only('ARMATURE', src_objs)
src_mesh = max((o for o in src_objs if o.type == 'MESH'),
               key=lambda o: len(o.data.vertices))
print('SUPPLIED', src_mesh.name, len(src_mesh.data.vertices), 'verts',
      len(src_arm.data.bones), 'bones')


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
# match the donor's height, so nearest-surface means what it says
sz, bz = src_mesh.dimensions.z, body.dimensions.z
if sz > 0 and abs(sz - bz) / bz > 0.01:
    k = bz / sz
    src_mesh.scale = (k, k, k)
    bpy.context.view_layer.objects.active = src_mesh
    bpy.ops.object.transform_apply(scale=True)
    print(f'SCALED supplied mesh by {k:.4f} to match {bz:.3f} m')

# ── weights ─────────────────────────────────────────────────────────
# Donor active, recipient selected — the operator's own direction.
# Its `use_reverse_transfer` flag looks like the tidier way to say this and
# cannot be used from Python: reversing swaps the two layer-select values
# internally, and 'ALL' is not in the destination property's enum, so the call
# is rejected before it runs.
bpy.ops.object.select_all(action='DESELECT')
src_mesh.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.data_transfer(
    data_type='VGROUP_WEIGHTS', use_create=True,
    vert_mapping='POLYINTERP_NEAREST',
    layers_select_src='ALL', layers_select_dst='NAME',
    mix_mode='REPLACE')
print('WEIGHTS transferred:', len(src_mesh.vertex_groups), 'groups')

src_mesh.parent = arm
src_mesh.matrix_parent_inverse = arm.matrix_world.inverted()
m = src_mesh.modifiers.new('Armature', 'ARMATURE')
m.object = arm

# ── material ────────────────────────────────────────────────────────
# the FBX points at the rigger's own disk; the maps ship beside it
def find(*keys):
    for f in sorted(os.listdir(TEXDIR)):
        low = f.lower()
        if any(k in low for k in keys):
            return os.path.join(TEXDIR, f)
    return None


mat = bpy.data.materials.new('Armored')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']


def hook(path, socket, non_color=False, via=None):
    if not path:
        print('NO MAP for', socket)
        return
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path)
    if non_color:
        tex.image.colorspace_settings.name = 'Non-Color'
    tex.image.pack()
    if via == 'normal':
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nm.inputs['Color'], tex.outputs['Color'])
        nt.links.new(bsdf.inputs['Normal'], nm.outputs['Normal'])
    else:
        nt.links.new(bsdf.inputs[socket], tex.outputs['Color'])


hook(find('_t_', 'albedo', 'basecolor', 'diffuse'), 'Base Color')
hook(find('_n_', 'normal'), 'Normal', non_color=True, via='normal')
hook(find('_r_', 'rough'), 'Roughness', non_color=True)
hook(find('_m_', 'metal'), 'Metallic', non_color=True)
src_mesh.data.materials.clear()
src_mesh.data.materials.append(mat)

# ── export ──────────────────────────────────────────────────────────
for o in list(bpy.data.objects):
    if o not in (src_mesh, arm) and o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE' and o is not arm:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=False,
                          export_yup=True, export_skins=True, export_materials='EXPORT',
                          export_image_format='AUTO')
src_mesh.data.calc_loop_triangles()
print('WROTE', OUT, os.path.getsize(OUT), len(src_mesh.data.loop_triangles), 'tris')
