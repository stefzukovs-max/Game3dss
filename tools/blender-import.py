"""
Import a supplied model in Blender and export it as GLB.

    blender -b [file.blend] --python tools/blender-import.py -- <out.glb> <texdir> [in.fbx]

Blender rather than three's own FBXLoader, and that is a decision with a
reason: the first supplied model went through three's importer and arrived as a
heap of detached panels, because the loader mishandles that file's pivots.
Blender reads the same file correctly. Everything supplied goes this way now.

Two things every one of these files has needed:

  · **Textures re-pointed.** They reference maps by whatever absolute path they
    had on the artist's machine, so every image datablock arrives empty. They
    are rematched against the supplied folder on two axes at once — which PART
    the image belongs to and which MAP it is — because a name-similarity match
    puts a bump map in the base-colour slot ("body" is closer in spelling to
    Body_Bump than to Body_Color) and the model comes out grey.

  · **Reported, not assumed.** What is printed here — object types, whether
    there is an armature, triangle count — is how the caller finds out whether
    a "character" is actually riggable or just a statue.
"""
import bpy, sys, os, re

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, TEXDIR = argv[0], argv[1]
SRC = argv[2] if len(argv) > 2 else None

if SRC:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    low = SRC.lower()
    if low.endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=SRC)
    elif low.endswith('.obj'):
        bpy.ops.wm.obj_import(filepath=SRC)
    elif low.endswith('.dae'):
        bpy.ops.wm.collada_import(filepath=SRC)
    else:
        raise SystemExit(f'unsupported source: {SRC}')

files = [f for f in os.listdir(TEXDIR)
         if f.lower().endswith(('.png', '.jpg', '.jpeg', '.tga', '.bmp'))] if TEXDIR and os.path.isdir(TEXDIR) else []

PARTS = [
    ('brake', ['brake']), ('wheel', ['wheel', 'tire', 'tyre']), ('rooflight', ['rooflight']),
    ('interior', ['interior']), ('eyes', ['eye']), ('hair', ['hair']),
    ('clothing', ['cloth', 'shirt', 'pants', 'garment']), ('body', ['body', 'skin']),
    ('glass', ['glass', 'windshield', 'window']), ('metal', ['metal']),
]
TYPES = [
    ('rough', ['rough']), ('metalness', ['metal', 'metallic']), ('bump', ['bump']),
    ('normal', ['norm']), ('emissive', ['emmis', 'emiss']), ('ao', ['_ao', 'occlusion']),
    ('opacity', ['opacity', 'alpha']), ('color', ['color', 'colour', 'diff', 'albedo', 'basecolor']),
]


def flat(s):
    return re.sub(r'[^a-z0-9]', '', os.path.splitext(os.path.basename(s))[0].lower())


def classify(s, table, default=None):
    f = flat(s)
    for name, keys in table:
        if any(k in f for k in keys):
            return name
    return default


fixed, missed = [], []
for img in bpy.data.images:
    if img.source == 'GENERATED' or (img.has_data and img.size[0]):
        continue
    want_part = classify(img.name, PARTS)
    want_kind = classify(img.name, TYPES, 'color')
    hit = None
    if want_part:
        same = [f for f in files
                if classify(f, PARTS) == want_part and classify(f, TYPES, 'color') == want_kind]
        hit = same[0] if same else None
    if not hit:
        # fall back to the plain filename, which is right more often than not
        base = os.path.basename(img.filepath_raw or img.name).lower()
        hit = next((f for f in files if f.lower() == base), None)
    if not hit:
        stem = flat(img.name)
        hit = next((f for f in files if stem and stem in flat(f)), None)
    if not hit:
        missed.append(img.name)
        continue
    img.filepath = os.path.join(TEXDIR, hit)
    img.source = 'FILE'
    try:
        img.reload()
        img.pack()
        fixed.append(f'{img.name} <- {hit}')
    except Exception as e:
        missed.append(f'{img.name} ({e})')

tris = 0
kinds = {}
for o in bpy.data.objects:
    kinds[o.type] = kinds.get(o.type, 0) + 1
    if o.type == 'MESH':
        try:
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
        except Exception:
            pass

print('KINDS', kinds)
print('TRIS', tris)
print('ARMATURE', 'yes' if kinds.get('ARMATURE') else 'no')
print('MATERIALS', [m.name for m in bpy.data.materials][:24])
print('FIXED', len(fixed))
for f in fixed:
    print('   ', f)
if missed:
    print('MISSED', missed)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_yup=True, export_materials='EXPORT', export_image_format='AUTO')
print('WROTE', OUT, os.path.getsize(OUT))
