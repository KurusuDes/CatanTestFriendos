# Textured, smooth-shaded asset kit for Catan x Kchudites ("realistic tabletop miniature").
# Run headless:
#   blender --background --python tools/blender/build_assets.py -- <out.glb> <textures dir>
# - organic props: Subdivision Surface + smooth shading
# - UVs from a world-scale cube projection so tileable textures keep a consistent size
# - ambient occlusion baked with Cycles into vertex colours (COLOR_0, multiplied in three.js)
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else 'kit.glb'
TEXDIR = ARGS[1] if len(ARGS) > 1 else os.path.join(os.path.dirname(OUT), '..', 'textures')
random.seed(2024)
bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# name: (base colour, roughness, metallic, texture)
PAL = dict(
    Bark=('#ffffff', .95, 0, 'bark.jpg'), Leaf=('#ffffff', .85, 0, 'leaves.jpg'), Leaf2=('#ffffff', .85, 0, 'leaves.jpg'),
    LeafDark=('#ffffff', .85, 0, 'leaves.jpg'), Pine=('#ffffff', .9, 0, 'pine.jpg'), Pine2=('#ffffff', .9, 0, 'pine.jpg'),
    Rock=('#ffffff', .95, 0, 'rockprop.jpg'), RockDark=('#ffffff', .95, 0, 'rockprop.jpg'), Moss=('#6f8f4a', .95, 0, None),
    Wool=('#ffffff', .98, 0, 'wool.jpg'), Face=('#3a3230', .8, 0, None), Straw=('#e2b94f', .85, 0, None), Straw2=('#c99a33', .85, 0, None),
    Clay=('#b3643f', .95, 0, None), Brick=('#ffffff', .9, 0, 'bricks.jpg'), PlayerWood=('#ffffff', .75, 0, 'paint.jpg'), Plaster=('#ffffff', .9, 0, 'plaster.jpg'),
    Timber=('#ffffff', .85, 0, 'planks.jpg'), Stone=('#ffffff', .92, 0, 'stone.jpg'), StoneDark=('#ffffff', .92, 0, 'stone.jpg'),
    Glass=('#1f2a36', .15, 0.1, None), Player=('#ffffff', .7, 0, 'roof.jpg'), Wood=('#ffffff', .8, 0, 'planks.jpg'),
    Cloth=('#f5efe0', .95, 0, None), Dark=('#26252c', .8, 0, None), Scarf=('#c93a33', .8, 0, None), Gold=('#ffcc40', .25, .9, None),
    Cactus=('#5c8f4a', .85, 0, None), Metal=('#6d7078', .4, .7, None), Banner=('#ffffff', .9, 0, None),
)
MATS = {}
IMGS = {}


def mat(name):
    if name in MATS:
        return MATS[name]
    col, rough, metal, tex = PAL[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(col), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if tex and os.path.exists(os.path.join(TEXDIR, tex)):
        if tex not in IMGS:
            IMGS[tex] = bpy.data.images.load(os.path.join(TEXDIR, tex))
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = IMGS[tex]
        nt.links.new(n.outputs['Color'], b.inputs['Base Color'])
    MATS[name] = m
    return m


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def part(name, geom, mname, M=Matrix.Identity(4), subsurf=0, smooth=True, displace=0.0, seed=0, dscale=3.1):
    bm = bmesh.new()
    geom(bm)
    if displace:
        for v in bm.verts:
            if v.co.length < 1e-5:
                continue
            n = noise.noise(v.co * dscale + Vector((seed, seed * 2, seed * 3)))
            v.co += v.co.normalized() * n * displace
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    o = new_obj(name, bm)
    o.data.materials.append(mat(mname))
    for p in o.data.polygons:
        p.use_smooth = smooth
    if subsurf:
        mod = o.modifiers.new('sub', 'SUBSURF')
        mod.levels = mod.render_levels = subsurf
    return o


def join(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        bpy.context.view_layer.objects.active = p
        for m in list(p.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o


T = lambda x=0, y=0, z=0: Matrix.Translation((x, y, z))
S = lambda x, y=None, z=None: Matrix.Diagonal((x, y if y is not None else x, z if z is not None else x, 1))
RZ = lambda a: Matrix.Rotation(a, 4, 'Z')
RX = lambda a: Matrix.Rotation(a, 4, 'X')
RY = lambda a: Matrix.Rotation(a, 4, 'Y')


def cyl(seg, r1, r2, d, caps=True):
    return lambda bm: bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=d)


def box():
    return lambda bm: bmesh.ops.create_cube(bm, size=1.0)


def sph(sub, r):
    return lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)


def uvs(seg, ring, r):
    return lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=r)


def bbox(name, mname, sx, sy, sz, M=Matrix.Identity(4), bevel=0.006):
    o = part(name, box(), mname, M @ S(sx, sy, sz), smooth=False)
    b = o.modifiers.new('bev', 'BEVEL')
    b.width = bevel
    b.segments = 2
    b.limit_method = 'ANGLE'
    return o


def gable(w, d, h, thick=0.012):
    """gable roof with real thickness"""
    def g(bm):
        pts_out = [(-w, -d, 0), (w, -d, 0), (0, -d, h), (-w, d, 0), (w, d, 0), (0, d, h)]
        pts_in = [(-w + thick * 1.5, -d, thick), (w - thick * 1.5, -d, thick), (0, -d, h - thick * 1.4),
                  (-w + thick * 1.5, d, thick), (w - thick * 1.5, d, thick), (0, d, h - thick * 1.4)]
        o = [bm.verts.new(p) for p in pts_out]
        i = [bm.verts.new(p) for p in pts_in]
        # outer slopes
        bm.faces.new((o[0], o[2], o[5], o[3]))
        bm.faces.new((o[1], o[4], o[5], o[2]))
        # inner slopes
        bm.faces.new((i[0], i[3], i[5], i[2]))
        bm.faces.new((i[1], i[2], i[5], i[4]))
        # front/back rims (between outer and inner)
        for a, b_, c_, d_ in [(0, 2, 2, 0), (2, 1, 1, 2)]:
            pass
        bm.faces.new((o[0], i[0], i[2], o[2]))
        bm.faces.new((o[2], i[2], i[1], o[1]))
        bm.faces.new((o[3], o[5], i[5], i[3]))
        bm.faces.new((o[5], o[4], i[4], i[5]))
        # eaves
        bm.faces.new((o[0], o[3], i[3], i[0]))
        bm.faces.new((o[1], i[1], i[4], o[4]))
    return g


def gable_wall(w, h, y):
    """triangular gable end"""
    def g(bm):
        vs = [bm.verts.new(p) for p in [(-w, y, 0), (w, y, 0), (0, y, h)]]
        bm.faces.new(vs)
    return g


# ---------------------------------------------------------------- vegetation
def tree_oak(name='oak', seed=1):
    r = random.Random(seed)
    parts = [part('t', cyl(12, 0.03, 0.017, 0.22), 'Bark', T(0, 0, 0.11), displace=0.004, seed=seed)]
    for a in (0.6, 2.8, 4.6):
        parts.append(part('br', cyl(8, 0.012, 0.006, 0.13), 'Bark', T(math.cos(a) * 0.03, math.sin(a) * 0.03, 0.2) @ RZ(a) @ RY(0.9) @ T(0, 0, 0.05)))
    blobs = []
    for i in range(10):
        a = r.random() * math.tau
        rr = 0.03 + r.random() * 0.075
        z = 0.24 + r.random() * 0.13 - rr * 0.4
        blobs.append((math.cos(a) * rr, math.sin(a) * rr, z, 0.06 + r.random() * 0.035))
    blobs.append((0, 0, 0.36, 0.08))
    for i, (x, y, z, rad) in enumerate(blobs):
        parts.append(part('c', sph(1, rad), ['Leaf', 'Leaf2', 'LeafDark'][i % 3], T(x, y, z) @ S(1, 1, 0.85), subsurf=2, displace=0.1 * rad / 0.08, seed=seed * 7 + i, dscale=7))
    return join(name, parts)


def tree_pine(name='pine', seed=2):
    parts = [part('t', cyl(10, 0.024, 0.016, 0.16), 'Bark', T(0, 0, 0.08))]
    tiers = 6
    for i in range(tiers):
        z = 0.12 + i * 0.062
        rad = 0.15 - i * 0.022
        h = 0.14 - i * 0.008
        parts.append(part('c', cyl(18, rad, 0.012 if i < tiers - 1 else 0.0, h), 'Pine' if i % 2 == 0 else 'Pine2', T(0, 0, z + h / 2) @ RZ(i * 0.9), displace=0.018, seed=seed * 11 + i, dscale=22))
    return join(name, parts)


def rock(name='rock', seed=3):
    return join(name, [part('r', sph(2, 0.1), 'Rock', T(0, 0, 0.025) @ S(1.3, 1.0, 0.62), smooth=False, displace=0.42, seed=seed, dscale=3.2),
                       part('m', sph(2, 0.06), 'Moss', T(0.02, 0.01, 0.085) @ S(1.4, 1.1, 0.3), subsurf=1, displace=0.2, seed=seed + 9)])


def bush(name='bush', seed=4):
    return join(name, [part('b', sph(1, 0.07), 'LeafDark', T(0, 0, 0.04) @ S(1.3, 1.1, 0.8), subsurf=2, displace=0.14, seed=seed, dscale=8),
                       part('b', sph(1, 0.05), 'Leaf', T(0.05, 0.02, 0.05), subsurf=2, displace=0.14, seed=seed + 1, dscale=8)])


def sheep(name='sheep'):
    parts = []
    for i, (x, y, z) in enumerate([(0, 0, 0.1), (0.04, 0.02, 0.11), (-0.04, -0.02, 0.105), (0.02, -0.03, 0.12), (-0.03, 0.03, 0.12), (0.0, 0.0, 0.13)]):
        parts.append(part('w', sph(1, 0.055), 'Wool', T(x, y, z), subsurf=2, displace=0.1, seed=i, dscale=9))
    parts.append(part('h', uvs(14, 10, 0.034), 'Face', T(0.097, 0, 0.128) @ S(1.35, 0.9, 1)))
    for sgn in (-1, 1):
        parts.append(part('e', uvs(8, 6, 0.014), 'Face', T(0.088, sgn * 0.034, 0.148) @ S(0.6, 1.7, 0.6)))
    for x in (-0.04, 0.045):
        for y in (-0.028, 0.028):
            parts.append(part('l', cyl(8, 0.011, 0.009, 0.07), 'Face', T(x, y, 0.035)))
    return join(name, parts)


def wheat_sheaf(name='sheaf'):
    parts = [part('s', cyl(18, 0.05, 0.03, 0.2), 'Straw', T(0, 0, 0.1), displace=0.006, dscale=40),
             part('s', cyl(18, 0.03, 0.068, 0.1), 'Straw2', T(0, 0, 0.24), displace=0.01, dscale=40),
             part('band', cyl(18, 0.053, 0.053, 0.02), 'Timber', T(0, 0, 0.14))]
    return join(name, parts)


def hay_bale(name='hay'):
    o = part('h', cyl(24, 0.08, 0.08, 0.12), 'Straw', T(0, 0, 0.08) @ RX(math.pi / 2), displace=0.004, dscale=50)
    b = o.modifiers.new('bev', 'BEVEL')
    b.width = 0.012
    b.segments = 3
    return join(name, [o])


def cactus(name='cactus'):
    parts = [part('c', cyl(14, 0.035, 0.03, 0.3), 'Cactus', T(0, 0, 0.15), subsurf=1),
             part('c', cyl(12, 0.022, 0.02, 0.1), 'Cactus', T(0.05, 0, 0.2) @ RY(-1.2), subsurf=1),
             part('c', cyl(12, 0.02, 0.018, 0.08), 'Cactus', T(-0.04, 0, 0.15) @ RY(1.1), subsurf=1)]
    return join(name, parts)


def crystal(name='crystal'):
    parts = []
    for i in range(6):
        a = i / 6 * math.pi * 2
        h = 0.12 + (i % 3) * 0.045
        parts.append(part('g', cyl(6, 0.034, 0.0, h), 'Gold', T(math.cos(a) * 0.045, math.sin(a) * 0.045, h / 2) @ RX(0.3 * math.cos(a)) @ RY(0.3 * math.sin(a)), smooth=False))
    parts.append(part('r', sph(3, 0.065), 'RockDark', T(0, 0, 0.0) @ S(1.4, 1.4, 0.6), displace=0.3, dscale=6))
    return join(name, parts)


# ---------------------------------------------------------------- buildings
def house(name='house'):
    W, D, H = 0.2, 0.15, 0.12
    parts = [bbox('found', 'Stone', W + 0.02, D + 0.02, 0.035, T(0, 0, 0.0175)),
             bbox('walls', 'Plaster', W, D, H, T(0, 0, 0.035 + H / 2)),
             part('roof', gable(W / 2 + 0.025, D / 2 + 0.02, 0.1), 'Player', T(0, 0, 0.035 + H - 0.004), smooth=False),
             part('gf', gable_wall(W / 2, 0.095, -D / 2), 'Plaster', T(0, 0, 0.035 + H), smooth=False),
             part('gb', gable_wall(W / 2, 0.095, D / 2), 'Plaster', T(0, 0, 0.035 + H) @ RZ(math.pi), smooth=False),
             bbox('ridge', 'Timber', 0.012, D + 0.05, 0.012, T(0, 0, 0.035 + H + 0.096), bevel=0.002),
             bbox('chim', 'Stone', 0.035, 0.035, 0.1, T(0.06, 0.035, 0.035 + H + 0.06)),
             bbox('chimcap', 'StoneDark', 0.045, 0.045, 0.012, T(0.06, 0.035, 0.035 + H + 0.11)),
             bbox('door', 'Timber', 0.038, 0.01, 0.068, T(0, -D / 2 - 0.004, 0.035 + 0.034)),
             bbox('frame', 'Timber', 0.05, 0.008, 0.008, T(0, -D / 2 - 0.004, 0.035 + 0.072))]
    for x in (-0.062, 0.062):
        parts.append(bbox('win', 'Glass', 0.032, 0.008, 0.032, T(x, -D / 2 - 0.003, 0.035 + 0.068), bevel=0.002))
        parts.append(bbox('sill', 'Timber', 0.04, 0.016, 0.006, T(x, -D / 2 - 0.006, 0.035 + 0.05), bevel=0.001))
    for x in (-W / 2, W / 2):
        for y in (-D / 2, D / 2):
            parts.append(bbox('post', 'Timber', 0.012, 0.012, H, T(x, y, 0.035 + H / 2), bevel=0.002))
    parts.append(bbox('beam', 'Timber', W + 0.005, 0.01, 0.01, T(0, -D / 2 - 0.002, 0.035 + H * 0.55), bevel=0.002))
    return join(name, parts)


def city(name='city'):
    parts = [bbox('base', 'StoneDark', 0.42, 0.32, 0.04, T(0, 0, 0.02)),
             bbox('keep', 'Stone', 0.15, 0.15, 0.34, T(-0.06, 0.03, 0.04 + 0.17)),
             part('kr', cyl(4, 0.125, 0.0, 0.17), 'Player', T(-0.06, 0.03, 0.04 + 0.34 + 0.085) @ RZ(math.pi / 4), smooth=False),
             bbox('hall', 'Plaster', 0.15, 0.11, 0.12, T(0.1, -0.04, 0.04 + 0.06)),
             part('hr', gable(0.095, 0.075, 0.08), 'Player', T(0.1, -0.04, 0.16), smooth=False),
             bbox('gate', 'Timber', 0.05, 0.01, 0.06, T(0, -0.155, 0.07))]
    for x, y in [(-0.18, -0.13), (0.18, -0.13), (0.18, 0.13), (-0.18, 0.13)]:
        parts.append(part('tw', cyl(20, 0.042, 0.04, 0.22), 'Stone', T(x, y, 0.04 + 0.11)))
        parts.append(part('tr', cyl(20, 0.056, 0.0, 0.1), 'Player', T(x, y, 0.04 + 0.22 + 0.05)))
    for sgn in (-1, 1):
        parts.append(bbox('wall', 'Stone', 0.34, 0.024, 0.09, T(0, sgn * 0.13, 0.04 + 0.045)))
        parts.append(bbox('wall', 'Stone', 0.024, 0.24, 0.09, T(sgn * 0.18, 0, 0.04 + 0.045)))
        for k in range(5):
            parts.append(bbox('cren', 'Stone', 0.025, 0.028, 0.02, T(-0.12 + k * 0.06, sgn * 0.13, 0.04 + 0.1), bevel=0.002))
    for i in range(4):
        parts.append(bbox('kc', 'Stone', 0.03, 0.03, 0.03, T(-0.06 + (i % 2 - 0.5) * 0.12, 0.03 + (i // 2 - 0.5) * 0.12, 0.04 + 0.35), bevel=0.002))
    parts.append(part('pole', cyl(8, 0.005, 0.005, 0.16), 'Timber', T(-0.06, 0.03, 0.62)))
    parts.append(bbox('flag', 'Banner', 0.07, 0.005, 0.045, T(-0.025, 0.03, 0.675), bevel=0.001))
    return join(name, parts)


def road(name='road'):
    parts = [bbox('bed', 'Wood', 0.56, 0.08, 0.026, T(0, 0, 0.013), bevel=0.008)]
    for i in range(7):
        parts.append(bbox('pl', 'PlayerWood', 0.068, 0.125, 0.018, T(-0.234 + i * 0.078, 0, 0.034), bevel=0.004))
    for sgn in (-1, 1):
        parts.append(bbox('rail', 'PlayerWood', 0.56, 0.014, 0.014, T(0, sgn * 0.058, 0.05), bevel=0.003))
    return join(name, parts)


def robber(name='robber'):
    parts = [part('b', cyl(22, 0.12, 0.06, 0.34), 'Dark', T(0, 0, 0.17), subsurf=1, displace=0.01, dscale=30),
             part('h', uvs(18, 12, 0.075), 'Dark', T(0, 0, 0.39)),
             part('hood', cyl(22, 0.09, 0.0, 0.14), 'Dark', T(0, -0.01, 0.46), subsurf=1),
             part('s', cyl(22, 0.085, 0.08, 0.035), 'Scarf', T(0, 0, 0.33), subsurf=1),
             part('bag', uvs(14, 10, 0.05), 'Cloth', T(0.08, 0.07, 0.18), displace=0.1, dscale=30)]
    return join(name, parts)


def dock(name='dock'):
    parts = [bbox('deck', 'Wood', 0.5, 0.2, 0.025, T(0, 0, 0))]
    for x in (-0.22, -0.07, 0.07, 0.22):
        for y in (-0.09, 0.09):
            parts.append(part('post', cyl(10, 0.018, 0.016, 0.32), 'Bark', T(x, y, -0.09)))
    return join(name, parts)


def boat(name='boat'):
    def hull(bm):
        pts_top = [(-0.2, -0.07, 0.06), (0.1, -0.075, 0.065), (0.25, 0, 0.09), (0.1, 0.075, 0.065), (-0.2, 0.07, 0.06), (-0.23, 0, 0.065)]
        pts_bot = [(-0.17, -0.035, -0.02), (0.08, -0.04, -0.03), (0.2, 0, 0.0), (0.08, 0.04, -0.03), (-0.17, 0.035, -0.02), (-0.19, 0, -0.01)]
        top = [bm.verts.new(p) for p in pts_top]
        bot = [bm.verts.new(p) for p in pts_bot]
        n = len(top)
        for i in range(n):
            bm.faces.new((top[i], bot[i], bot[(i + 1) % n], top[(i + 1) % n]))
        bm.faces.new(list(reversed(top)))
        bm.faces.new(bot)

    def sail(bm):
        vs = [bm.verts.new(p) for p in [(0.0, 0, 0.1), (0.0, 0, 0.45), (0.18, 0.03, 0.12)]]
        bm.faces.new(vs)
    return join(name, [part('hull', hull, 'Wood', subsurf=1), part('mast', cyl(8, 0.008, 0.006, 0.44), 'Bark', T(0, 0, 0.26)),
                       part('sail', sail, 'Cloth', smooth=False)])


def windmill(name='windmill'):
    parts = [part('tower', cyl(20, 0.075, 0.052, 0.3), 'Plaster', T(0, 0, 0.15)),
             part('base', cyl(20, 0.085, 0.085, 0.03), 'Stone', T(0, 0, 0.015)),
             part('cap', cyl(20, 0.068, 0.0, 0.11), 'Timber', T(0, 0, 0.355)),
             bbox('door', 'Timber', 0.035, 0.01, 0.06, T(0, -0.075, 0.06))]
    for i in range(4):
        parts.append(bbox('blade', 'Cloth', 0.022, 0.005, 0.17, T(0.08, 0, 0.3) @ RX(i * math.pi / 2) @ T(0, 0, 0.095), bevel=0.001))
        parts.append(bbox('spar', 'Timber', 0.006, 0.006, 0.19, T(0.084, 0, 0.3) @ RX(i * math.pi / 2) @ T(0, 0, 0.095), bevel=0.001))
    return join(name, parts)


def kiln(name='kiln'):
    parts = [part('dome', uvs(22, 12, 0.1), 'Brick', T(0, 0, 0.0) @ S(1, 1, 0.75), displace=0.01, dscale=30),
             part('base', cyl(22, 0.11, 0.11, 0.03), 'Stone', T(0, 0, 0.015)),
             bbox('chim', 'Brick', 0.035, 0.035, 0.12, T(0.05, 0, 0.14)),
             bbox('door', 'Dark', 0.04, 0.02, 0.05, T(0, -0.095, 0.03))]
    for i in range(3):
        parts.append(bbox('stack', 'Brick', 0.07, 0.035, 0.03, T(0.14, -0.05, 0.015 + i * 0.03), bevel=0.004))
    return join(name, parts)


def mine(name='mine'):
    parts = [part('rock', sph(3, 0.14), 'RockDark', T(0, 0, 0.02) @ S(1.3, 1, 0.8), displace=0.3, dscale=5),
             bbox('frame', 'Timber', 0.12, 0.02, 0.015, T(0, -0.12, 0.13)),
             bbox('post', 'Timber', 0.015, 0.02, 0.12, T(-0.05, -0.12, 0.06)),
             bbox('post', 'Timber', 0.015, 0.02, 0.12, T(0.05, -0.12, 0.06)),
             bbox('hole', 'Dark', 0.085, 0.01, 0.1, T(0, -0.118, 0.05)),
             bbox('cart', 'Metal', 0.06, 0.04, 0.035, T(0.12, -0.16, 0.03))]
    return join(name, parts)


def lumber(name='lumber'):
    parts = [bbox('hut', 'Wood', 0.14, 0.1, 0.08, T(0, 0, 0.04)),
             part('roof', gable(0.085, 0.06, 0.065), 'Timber', T(0, 0, 0.078), smooth=False)]
    for i in range(3):
        parts.append(part('log', cyl(12, 0.018, 0.018, 0.14), 'Bark', T(0.12, -0.05 + i * 0.038, 0.02) @ RX(math.pi / 2)))
    return join(name, parts)


def fence(name='fence'):
    parts = [bbox('rail', 'Wood', 0.3, 0.01, 0.012, T(0, 0, 0.05), bevel=0.003), bbox('rail', 'Wood', 0.3, 0.01, 0.012, T(0, 0, 0.025), bevel=0.003)]
    for x in (-0.14, 0, 0.14):
        parts.append(bbox('p', 'Timber', 0.015, 0.015, 0.07, T(x, 0, 0.035), bevel=0.003))
    return join(name, parts)


builders = [tree_oak, tree_pine, rock, bush, sheep, wheat_sheaf, hay_bale, cactus, crystal, house, city, road, robber, dock, boat,
            windmill, kiln, mine, lumber, fence]
objs = []
for i, fn in enumerate(builders):
    o = fn()
    o.location = ((i % 5) * 2.0, (i // 5) * 2.0, 0)
    objs.append(o)

# ---------------------------------------------------------------- UVs (world-scale cube projection)
for o in objs:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=0.35, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- AO bake into vertex colours
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.render.bake.target = 'VERTEX_COLORS'
world = bpy.data.worlds.new('w')
scene.world = world
world.light_settings.distance = 0.12
for o in objs:
    ca = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'POINT')
    o.data.color_attributes.active_color = ca
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.object.bake(type='AO')
    except Exception as e:
        print('bake failed', o.name, e)
    # soften: AO in [0.45, 1] so textures never go black
    for d in ca.data:
        c = d.color
        v = 0.45 + 0.55 * c[0]
        d.color = (v, v, v, 1)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_image_format='JPEG', export_jpeg_quality=85)
print('EXPORTED', OUT, sorted(o.name for o in objs))
