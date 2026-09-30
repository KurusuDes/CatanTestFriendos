# Resource icons rendered from real 3D models with a "pixel camera".
# Each resource is modelled with simple primitives and rendered by Workbench (no anti-aliasing)
# through an orthographic 3/4 camera at the sprite's native size (16 and 32 px), twice:
# a FLAT pass says which material each pixel is, a white STUDIO pass says how lit it is. Then:
#   1. the light is banded into the 4 tones of that material's pixel-art ramp
#      (shadows lean purple, highlights lean warm),
#   2. a 1px dark outline goes around the silhouette,
#   3. a 1px light "sticker" ring goes around that, so the icon reads on any card colour.
# Run headless:
#   blender --background --python tools/blender/make_icons.py -- assets/icons
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'assets/icons')
os.makedirs(OUT, exist_ok=True)
SIZES = (16, 32)
OUTLINE = (20, 12, 28)
STICKER = (255, 241, 232)


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lin(c):
    return tuple((x / 255) / 12.92 if x / 255 <= 0.04045 else (((x / 255) + 0.055) / 1.055) ** 2.4 for x in c)


def ramp(base):
    """4 pixel-art tones from a base colour: hue-shifted shadow -> highlight"""
    r, g, b = hexrgb(base)
    out = []
    for k, (lum, tint) in enumerate([(0.52, (0.92, 0.88, 1.12)), (0.76, (0.97, 0.95, 1.05)), (1.0, (1, 1, 1)), (1.22, (1.06, 1.05, 0.9))]):
        out.append(tuple(max(0, min(255, round(c * lum * t))) for c, t in zip((r, g, b), tint)))
    return out


# name: base colour (the ramp is derived from it)
MATS = dict(
    leaf='#3aa845', leafdark='#227a3f', bark='#8a5232', brick='#d0603f', mortar='#e8d2b0', wool='#f2eee6',
    face='#3b3140', straw='#f2c243', stem='#c68a2e', band='#d8363f', rock='#9aa0ab', crystal='#39b8ff',
    gold='#ffc93a', cactus='#4cae4f', sand='#f0d49a', flower='#ff5d8f',
)
MAT_OBJ = {}


def mat(name):
    if name not in MAT_OBJ:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*lin(hexrgb(MATS[name])), 1)
        m.roughness = 0.9
        MAT_OBJ[name] = m
    return MAT_OBJ[name]


def obj(name, geom, mname, M=Matrix.Identity(4), smooth=False, displace=0.0, seed=0):
    bm = bmesh.new()
    geom(bm)
    if displace:
        for v in bm.verts:
            v.co += v.co.normalized() * noise.noise(v.co * 3.1 + Vector((seed, seed, seed))) * displace
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(mat(mname))
    k = len(bpy.context.scene.objects) + 1  # unique colour per part for the joints pass
    o.color = ((k * 37 % 97) / 97, (k * 61 % 89) / 89, (k * 17 % 83) / 83, 1)
    bpy.context.scene.collection.objects.link(o)
    return o


T = lambda x=0, y=0, z=0: Matrix.Translation((x, y, z))
S = lambda x, y=None, z=None: Matrix.Diagonal((x, y if y is not None else x, z if z is not None else x, 1))
RX = lambda a: Matrix.Rotation(a, 4, 'X')
RY = lambda a: Matrix.Rotation(a, 4, 'Y')
RZ = lambda a: Matrix.Rotation(a, 4, 'Z')
cone = lambda seg, r1, r2, d: (lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=d))
cube = lambda: (lambda bm: bmesh.ops.create_cube(bm, size=1.0))
ico = lambda sub, r: (lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r))


# ---------------------------------------------------------------- models
def wood():
    obj('trunk', cone(8, 0.09, 0.07, 0.34), 'bark', T(0, 0, 0.17))
    for i, (r, h, z) in enumerate([(0.52, 0.5, 0.52), (0.42, 0.44, 0.8), (0.3, 0.4, 1.06)]):
        obj('tier', cone(9, r, 0.02, h), 'leaf' if i % 2 == 0 else 'leafdark', T(0, 0, z) @ RZ(i * 0.3))
    obj('log', cone(8, 0.08, 0.08, 0.5), 'bark', T(0.42, -0.25, 0.08) @ RZ(0.9) @ RY(math.pi / 2))


def brick():
    # a little pyramid of bricks with visible joints
    for x, z in [(-0.29, 0.1), (0.29, 0.1), (0, 0.32)]:
        obj('brick', cube(), 'brick', T(x, 0, z) @ S(0.54, 0.3, 0.2))


def sheep():
    body = [(0, 0, 0.42, 0.26), (0.18, 0.05, 0.46, 0.2), (-0.18, 0.02, 0.44, 0.21), (0.05, -0.12, 0.5, 0.19), (-0.06, 0.13, 0.52, 0.19), (0.02, 0, 0.6, 0.18)]
    for i, (x, y, z, r) in enumerate(body):
        obj('wool', ico(2, r), 'wool', T(x, y, z), smooth=True, displace=0.02, seed=i)
    obj('head', ico(2, 0.14), 'face', T(0.36, -0.05, 0.52) @ S(1.1, 0.9, 1.0), smooth=True)
    obj('ear', ico(1, 0.05), 'face', T(0.33, -0.17, 0.6) @ S(1, 2, 0.6))
    obj('ear', ico(1, 0.05), 'face', T(0.33, 0.07, 0.6) @ S(1, 2, 0.6))
    for x, y in [(0.15, -0.1), (0.15, 0.1), (-0.15, -0.1), (-0.15, 0.1)]:
        obj('leg', cone(6, 0.045, 0.045, 0.28), 'face', T(x, y, 0.14))


def wheat():
    # a sheaf: stems tied in the middle, fanning out at both ends
    n = 8
    for i in range(n):
        a = (i / n) * math.tau + 0.2
        M = T(0, 0, 0.45) @ RZ(a) @ RX(0.5 + 0.1 * (i % 2))
        obj('stem', cone(5, 0.022, 0.022, 0.62), 'stem', M @ T(0, 0, 0.2))
        obj('ear', ico(1, 0.09), 'straw', M @ T(0, 0, 0.58) @ S(0.75, 0.75, 2.2), smooth=True)
        obj('foot', cone(5, 0.022, 0.022, 0.5), 'stem', T(0, 0, 0.45) @ RZ(a) @ RX(math.pi - 0.22) @ T(0, 0, 0.22))
    obj('band', cone(12, 0.12, 0.12, 0.1), 'band', T(0, 0, 0.45))


def ore():
    obj('rock', ico(2, 0.45), 'rock', T(0, 0, 0.28) @ S(1.15, 1.0, 0.7), displace=0.08, seed=3)
    for x, y, z, a, b, h in [(0.0, -0.1, 0.45, 0.15, 0.05, 0.62), (0.22, -0.12, 0.42, 0.1, 0.55, 0.42), (-0.22, -0.1, 0.42, -0.05, -0.6, 0.4), (0.08, 0.15, 0.45, -0.5, 0.2, 0.36)]:
        M = T(x, y, z) @ RX(a) @ RY(b)
        obj('prism', cone(6, 0.11, 0.11, h), 'crystal', M @ T(0, 0, h / 2))
        obj('tip', cone(6, 0.11, 0.0, 0.16), 'crystal', M @ T(0, 0, h + 0.08))


def gold():
    def ingot(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= 0.72
                v.co.y *= 0.62
    for x, z in [(-0.27, 0.1), (0.27, 0.1), (0, 0.31)]:
        obj('ingot', ingot, 'gold', T(x, 0, z) @ S(0.5, 0.32, 0.2))


def desert():
    obj('dune', ico(2, 0.6), 'sand', T(0, 0, 0) @ S(1.1, 0.9, 0.28), smooth=True)
    obj('trunk', cone(10, 0.14, 0.13, 0.95), 'cactus', T(0, 0, 0.5), smooth=True)
    obj('top', ico(2, 0.13), 'cactus', T(0, 0, 0.97), smooth=True)
    for sgn, h, z in [(1, 0.34, 0.42), (-1, 0.26, 0.55)]:
        obj('arm', cone(8, 0.08, 0.08, 0.22), 'cactus', T(sgn * 0.2, 0, z) @ RY(math.pi / 2))
        obj('armup', cone(8, 0.08, 0.075, h), 'cactus', T(sgn * 0.3, 0, z + h / 2), smooth=True)
        obj('armtop', ico(1, 0.075), 'cactus', T(sgn * 0.3, 0, z + h), smooth=True)
    obj('flower', ico(1, 0.06), 'flower', T(0, -0.05, 1.08))


ICONS = dict(wood=wood, brick=brick, sheep=sheep, wheat=wheat, ore=ore, gold=gold, desert=desert)
# icons whose parts are drawn with dark joints between them (a pile of bricks, a stack of ingots)
JOINTS = {'brick', 'gold', 'ore'}


# ---------------------------------------------------------------- render + pixel post
def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.render_aa = 'OFF'
    sh = sc.display.shading
    sh.light = 'FLAT'
    sh.color_type = 'MATERIAL'
    sh.single_color = (1, 1, 1)
    sh.show_specular_highlight = False
    sh.show_cavity = True
    sh.cavity_type = 'WORLD'
    sh.cavity_ridge_factor = 1.0
    sh.cavity_valley_factor = 1.0
    sh.show_shadows = True
    sh.shadow_intensity = 0.6
    sc.display.light_direction = (0.55, -0.35, 0.75)
    sc.render.film_transparent = True
    sc.render.dither_intensity = 0  # exact colours: the passes are compared pixel by pixel
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def frame(cam, margin_px, size):
    """3/4 orthographic view fitted to the model, leaving room for outline + sticker"""
    az, el = math.radians(-35), math.radians(28)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    rot = d.to_track_quat('Z', 'Y')
    right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
    pts = [o.matrix_world @ v.co for o in bpy.context.scene.objects if o.type == 'MESH' for v in o.data.vertices]
    xs, ys = [p.dot(right) for p in pts], [p.dot(up) for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    cam.data.ortho_scale = span * size / (size - 2 * margin_px)
    cam.location = right * cx + up * cy + d * 20
    cam.rotation_euler = rot.to_euler()
    cam.data.clip_end = 100


def render_pixels(path, size):
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    bpy.data.images.remove(img)
    return px


def passes(tmp, size):
    """(material id pass, light pass) at the sprite's native resolution"""
    sh = bpy.context.scene.display.shading
    sh.light, sh.color_type, sh.show_cavity, sh.show_shadows = 'FLAT', 'MATERIAL', False, False
    ids = render_pixels(tmp, size)
    sh.color_type = 'OBJECT'
    parts = render_pixels(tmp, size)
    sh.light, sh.color_type, sh.show_cavity, sh.show_shadows = 'STUDIO', 'SINGLE', True, True
    light = render_pixels(tmp, size)
    return ids, parts, light


def post(ids, parts, light, mats, joints=False):
    """material ramps banded by light + dark outline + light sticker ring (bottom-up rows)"""
    n = ids.shape[0]
    solid = ids[..., 3] > 0.5
    base = np.array([hexrgb(MATS[m]) for m in mats], dtype=np.float32)
    rgb = (ids[..., :3] * 255).reshape(-1, 3)
    mid = ((rgb[:, None, :] - base[None, :, :]) ** 2).sum(-1).argmin(1).reshape(n, n)
    L = light[..., :3].mean(-1)
    top = np.percentile(L[solid], 97) if solid.any() else 1
    L = L / max(top, 1e-4)
    band = np.digitize(L, [0.5, 0.74, 0.97])  # 0 shadow .. 3 highlight
    ramps = np.array([ramp(MATS[m]) for m in mats], dtype=np.uint8)
    out = np.zeros((n, n, 4), dtype=np.uint8)
    out[..., :3] = ramps[mid, band]
    out[..., 3] = np.where(solid, 255, 0)
    if joints:
        # 1px joint where the part changes towards the right/down neighbour: darkest ramp tone
        pid = (parts[..., :3] * 255).round().astype(np.int32)
        pid = pid[..., 0] * 65536 + pid[..., 1] * 256 + pid[..., 2]
        edge = np.zeros_like(solid)
        edge[:, :-1] |= (pid[:, :-1] != pid[:, 1:]) & solid[:, 1:]
        edge[1:, :] |= (pid[1:, :] != pid[:-1, :]) & solid[:-1, :]  # rows are bottom-up
        edge &= solid
        out[edge, :3] = ramps[mid[edge], 0] // 2 + np.array(OUTLINE, dtype=np.uint8) // 2

    def ring(mask, diag):
        pad = np.pad(mask, 1)
        nb = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
        if diag:
            nb |= pad[:-2, :-2] | pad[:-2, 2:] | pad[2:, :-2] | pad[2:, 2:]
        return nb & ~mask

    line = ring(solid, False)
    out[line] = (*OUTLINE, 255)
    both = solid | line
    stick = ring(both, True)
    out[stick] = (*STICKER, 255)
    return out


def save(arr, path):
    n = arr.shape[0]
    img = bpy.data.images.new('icon', n, n, alpha=True)
    img.pixels.foreach_set((arr.astype(np.float32) / 255).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def clear_meshes():
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
sc, cam = setup_scene()
tmp = os.path.join(OUT, '_render.png')
for name, build in ICONS.items():
    clear_meshes()
    build()
    used = sorted({m.name for o in sc.objects if o.type == 'MESH' for m in o.data.materials})
    for size in SIZES:
        frame(cam, 2, size)
        arr = post(*passes(tmp, size), used, name in JOINTS)
        save(arr, os.path.join(OUT, f'{name}_{size}.png'))
        print('icon', name, size)
os.remove(tmp)
