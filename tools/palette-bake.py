"""
Collapse a many-material model onto one tiny palette.

    blender -b --python tools/palette-bake.py -- <in.fbx> <texdir> <out.fbx> [--drop=A,B]

Some supplied models are not one textured mesh but a dozen objects, each with
its own material, several with no UVs at all because their colour lives in the
material rather than in an image. The stickman gangster is ten meshes and seven
materials: a red bandana with a 2048² paisley on it, a black hoodie with no UV
layer whatsoever, white shoelaces, brown bat, chains, skin.

Exported as-is that is seven draw calls per character. Twenty characters on
screen is a hundred and forty, on a budget the whole level is meant to fit in
two hundred and twenty. It is also four megabytes of texture for a figure that
is forty pixels tall in play.

So each material is reduced to the single colour it actually reads as, those
colours are written into a strip one texel per material, and every face's UVs
are moved to the middle of its own texel. The result is one mesh, one material,
one image a few hundred bytes in size, and a model that looks the same from
more than two metres away — which is the entire register this game is in.

Colour comes from the texture where there is one (averaged, so the paisley
bandana becomes the red it reads as) and from the material's own base colour
where there is not.
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, TEXDIR, OUT = argv[0], argv[1], argv[2]

"""
`--colour=NAME:RRGGBB` or `--colour=NAME:@substring` says what a material is.

Not every FBX carries its colours. The stickman gangster imports with seven
materials that are all pure white, no texture linked to any of them, and two
images that fail to resolve — the colour lives entirely in two PNGs beside the
file and in the material *names*, which are BLACK, BLANC, ROUGE, MARRON, SKIN
and so on. A model whose palette is written in French in its material names is
not going to be read by any heuristic, so it is given.

`@substring` averages a file in the texture directory instead of taking a
literal, which is how the skin tone and the bandana's red are lifted off the
supplied images rather than guessed at.
"""
DROP = set()
SCALE_TO = 0.0
COLOUR = {}
for a in argv[3:]:
    if a.startswith('--drop='):
        DROP |= {s for s in a[7:].split(',') if s}
    if a.startswith('--height='):
        SCALE_TO = float(a[9:])
    if a.startswith('--colour='):
        for pair in a[9:].split(','):
            k, _, v = pair.partition(':')
            if k and v:
                COLOUR[k] = v


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name in DROP:
        print('DROPPED', o.name)
        bpy.data.objects.remove(o, do_unlink=True)

"""
Parents first, and this is the trap that has bitten this project before.

The FBX parents every mesh to an empty that carries the file's unit scale, and
`transform_apply` does not touch a parent — the factor survives on the parent,
invisible to every measurement that goes through the object transform, and
then multiplies whatever you do next. Here the meshes sit at 0.0044 under an
empty at 0.01, so the figure is two and a half centimetres tall and every
bounding box agrees with itself while being wrong.

Clearing the parent while keeping the world transform folds the whole chain
into each object, and only then does applying it mean anything.
"""
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print('MESHES', [o.name for o in meshes])


def average_image(path):
    """Alpha-weighted mean of an image on disk, in linear RGB."""
    img = bpy.data.images.load(path, check_existing=True)
    px = img.pixels[:]
    n = len(px) // 4
    r = g = b = w = 0.0
    step = max(1, n // 20000)          # 20k samples is plenty for a mean
    for i in range(0, n, step):
        a = px[i * 4 + 3]
        r += px[i * 4] * a
        g += px[i * 4 + 1] * a
        b += px[i * 4 + 2] * a
        w += a
    return (r / w, g / w, b / w) if w > 0 else (0.5, 0.5, 0.5)


def average_colour(mat):
    """What this material reads as, in one linear RGB triple."""
    name = mat.name if mat else 'none'
    given = COLOUR.get(name)
    if given:
        if given.startswith('@'):
            key = given[1:].lower()
            for f in sorted(os.listdir(TEXDIR)):
                if key in f.lower():
                    return average_image(os.path.join(TEXDIR, f))
            print(f'  ! no texture matching {given!r} for {name}')
        else:
            h = given.lstrip('#')
            return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    if not mat or not mat.use_nodes:
        return (0.5, 0.5, 0.5)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return (0.5, 0.5, 0.5)
    link = bsdf.inputs['Base Color'].links
    if link:
        node = link[0].from_node
        img = getattr(node, 'image', None)
        if img and img.has_data:
            px = img.pixels[:]
            n = len(px) // 4
            # Alpha-weighted, so a mask with transparent margins does not
            # average its own empty space into the colour.
            r = g = b = w = 0.0
            step = max(1, n // 20000)          # 20k samples is plenty for a mean
            for i in range(0, n, step):
                a = px[i * 4 + 3]
                r += px[i * 4] * a
                g += px[i * 4 + 1] * a
                b += px[i * 4 + 2] * a
                w += a
            if w > 0:
                return (r / w, g / w, b / w)
    c = bsdf.inputs['Base Color'].default_value
    return (c[0], c[1], c[2])


# ── one colour per material, in a stable order ──────────────────────
palette = []            # [(name, (r,g,b))]
index = {}
for o in meshes:
    for slot in o.data.materials:
        name = slot.name if slot else 'none'
        if name not in index:
            index[name] = len(palette)
            palette.append((name, average_colour(slot)))
for name, c in palette:
    print(f'  PALETTE {name:34} {tuple(round(v, 3) for v in c)}')

"""
The strip is padded to a power of two and each colour is written across its
whole texel *and* its neighbours' halves are kept clear of it by sampling the
centre. Bilinear filtering between two texels is the one way this technique
goes wrong — a face landing on a boundary picks up a blend of two unrelated
colours — so the UV goes to the exact middle and the image stays small enough
that no mip ever merges bands the model actually uses.
"""
W = 1
while W < max(1, len(palette)):
    W *= 2
img = bpy.data.images.new('palette', width=W, height=1, alpha=False)
px = [0.0] * (W * 4)
for i in range(W):
    c = palette[min(i, len(palette) - 1)][1]
    px[i * 4:i * 4 + 4] = [c[0], c[1], c[2], 1.0]
img.pixels = px
img.filepath_raw = os.path.join(os.path.dirname(OUT), 'palette.png')
img.file_format = 'PNG'
img.save()
print('PALETTE strip', W, '×1 →', img.filepath_raw)

# ── rewrite every UV onto its material's texel ──────────────────────
for o in meshes:
    me = o.data
    """
    One UV layer, one name, on every mesh.

    `join` merges UV layers *by name*. These meshes disagree: the ones with a
    texture carry `map1`, the flat-coloured ones carry none at all and get a
    fresh layer. Join those and the result has two layers, each holding half
    the model's coordinates and zeroes for the other half — so half the
    character samples texel zero and the hoodie, the pants and the shoes all
    came out the colour of skin.
    """
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='palette')
    uv = me.uv_layers.active.data
    mats = [m.name if m else 'none' for m in me.materials] or ['none']
    for poly in me.polygons:
        slot = mats[min(poly.material_index, len(mats) - 1)]
        u = (index.get(slot, 0) + 0.5) / W
        for li in poly.loop_indices:
            uv[li].uv = (u, 0.5)

# ── one material, one image ─────────────────────────────────────────
mat = bpy.data.materials.new('Palette')
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
tex.interpolation = 'Closest'          # never blend two bands together
tex.image.pack()
nt.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])
bsdf.inputs['Roughness'].default_value = 0.78
bsdf.inputs['Metallic'].default_value = 0.0

for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(mat)

# ── join, stand up, size ────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = 'Character'

bpy.context.view_layer.update()
from mathutils import Vector


def extent(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector((max(c[i] for c in cs) - min(c[i] for c in cs) for i in range(3)))


d = extent(obj)
print('EXTENT', tuple(round(v, 4) for v in d))
if SCALE_TO:
    k = SCALE_TO / max(d.z, 1e-9)
    obj.scale = (k, k, k)
    bpy.ops.object.transform_apply(scale=True)
    print(f'SCALED ×{k:.2f} → {tuple(round(v, 3) for v in extent(obj))}')

obj.data.calc_loop_triangles()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.fbx(filepath=OUT, path_mode='COPY', embed_textures=True)
print('WROTE', OUT, os.path.getsize(OUT), len(obj.data.loop_triangles), 'tris,',
      len(palette), 'colours')
