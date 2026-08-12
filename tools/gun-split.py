"""
Split a supplied gun pack into one normalised GLB per weapon slot.

    blender -b guns.blend --python tools/gun-split.py -- <outdir> <obj>=<slot> ...

The pack arrives as a dozen meshes named Cube and Cylinder.001 through .009,
parked on a display grid, each at its own arbitrary rotation and at roughly
eight times life size. The weapon system expects one thing of a gun model — it
lies along +X, muzzle forward, and it will scale it to a real length itself —
so the whole job here is to work out, per mesh, which way it is actually
pointing and turn it to match.

Two measurements do that, and neither is guessable from the file:

  · **Which axis is the barrel.** The longest side of the bounding box, after
    the object's own transform is applied. Several of these are modelled
    upright and several lying down.

  · **Which end is the muzzle.** The long axis is cut into ten slices and each
    slice's cross-section is measured. A gun is bulky at the receiver and thin
    at the muzzle, so the thin end is the front. Getting this backwards points
    every shot out of the stock, and it is invisible in a still render.

Modifiers are applied before any of that, and the order is not optional. Most
of these meshes are modelled as one half with a mirror across the object's
origin, so applying the object's *location* first moves the mirror plane out
into the world and the gun comes out as two halves twelve metres apart. Only
the guns whose origin already sat on the mirror plane survived that, which is
the kind of bug that looks like it works on three models out of six.

Materials are left alone. The pack is untextured flat colour, which is what it
was authored as, and inventing a texture set for it would look worse.
"""
import bpy, sys, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OUTDIR = argv[0]
MAP = [a.split('=', 1) for a in argv[1:]]

os.makedirs(OUTDIR, exist_ok=True)


def world_bbox(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
    hi = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    return lo, hi


def muzzle_is_positive(o, axis):
    """Is the thin end of the mesh at the +axis end of its bounding box?"""
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = min(p[axis] for p in pts)
    hi = max(p[axis] for p in pts)
    span = hi - lo or 1.0
    other = [i for i in (0, 1, 2) if i != axis]
    BINS = 10
    girth = [0.0] * BINS
    for p in pts:
        b = min(BINS - 1, int((p[axis] - lo) / span * BINS))
        # distance from the barrel line, as a stand-in for cross-section
        girth[b] = max(girth[b], abs(p[other[0]]) + abs(p[other[1]]))
    # compare the outer fifth at each end; the slimmer one is the muzzle
    return (girth[-1] + girth[-2]) < (girth[0] + girth[1])


for name, slot in MAP:
    o = bpy.data.objects.get(name)
    if not o or o.type != 'MESH':
        print(f'MISSING {name}')
        continue

    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')          # bake the mirror in first
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    lo, hi = world_bbox(o)
    size = hi - lo
    axis = max(range(3), key=lambda i: size[i])

    # turn the barrel axis onto +X
    if axis == 1:
        o.matrix_world = Matrix.Rotation(-1.5707963, 4, 'Z') @ o.matrix_world
    elif axis == 2:
        o.matrix_world = Matrix.Rotation(1.5707963, 4, 'Y') @ o.matrix_world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    if not muzzle_is_positive(o, 0):
        o.matrix_world = Matrix.Rotation(3.1415927, 4, 'Z') @ o.matrix_world
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # sit the model on its own origin, so the loader's own recentring starts
    # from something sane rather than from a display-grid coordinate
    lo, hi = world_bbox(o)
    o.matrix_world = Matrix.Translation(-(lo + hi) / 2) @ o.matrix_world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    lo, hi = world_bbox(o)
    o.data.calc_loop_triangles()
    out = os.path.join(OUTDIR, slot + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_materials='EXPORT')
    print(f'{slot:10s} <- {name:14s} {len(o.data.loop_triangles):5d} tris  '
          f'{(hi - lo).x:.2f} long  -> {out} {os.path.getsize(out)}')
