# Detailed, smooth-shaded asset kit for Catan x Kchudites (Civilization VI inspired).
# Run headless:  blender --background --python tools/blender/build_assets.py -- assets/models/kit.glb
# Organic props get a Subdivision Surface + smooth shading; buildings keep crisp bevels.
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'kit.glb'
random.seed(2024)
bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MATS = {}
PAL = dict(
    Bark=('#5e4430', .9), Leaf=('#5f8f3e', .8), Leaf2=('#78a84a', .8), LeafDark=('#3f6b34', .8),
    Pine=('#2f5d3a', .85), Pine2=('#3c7044', .85), Rock=('#8d8b86', .9), RockDark=('#6c6a66', .9), Moss=('#6f8f4a', .9),
    Wool=('#f2efe6', .95), Face=('#3a3230', .8), Straw=('#e2b94f', .85), Straw2=('#c99a33', .85),
    Clay=('#b3643f', .9), Brick=('#9e4630', .85), Plaster=('#efe2c8', .85), Timber=('#5b3e2b', .8), Stone=('#b7ae9c', .9),
    StoneDark=('#8f8676', .9), Glass=('#2a3440', .3), Player=('#ffffff', .6), Wood=('#8a603f', .8), Cloth=('#f5efe0', .9),
    Dark=('#26252c', .7), Scarf=('#c93a33', .7), Gold=('#ffcc40', .25, .9), Cactus=('#5c8f4a', .8), Metal=('#6d7078', .4, .7),
    Water=('#4c93b0', .2),
)


def mat(name):
    if name in MATS:
        return MATS[name]
    args = PAL[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(args[0]), 1)
    b.inputs['Roughness'].default_value = args[1]
    b.inputs['Metallic'].default_value = args[2] if len(args) > 2 else 0.0
    MATS[name] = m
    return m


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def part(name, geom, mname, M=Matrix.Identity(4), subsurf=0, smooth=True, displace=0.0, seed=0):
    bm = bmesh.new()
    geom(bm)
    if displace:
        for v in bm.verts:
            n = noise.noise(v.co * 3.1 + Vector((seed, seed * 2, seed * 3)))
            v.co += v.co.normalized() * n * displace if v.co.length > 1e-4 else Vector()
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
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        for m in p.modifiers:
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
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


def bevel_box(name, mname, sx, sy, sz, M=Matrix.Identity(4), bevel=0.01):
    o = part(name, box(), mname, M @ S(sx, sy, sz), smooth=False)
    b = o.modifiers.new('bev', 'BEVEL')
    b.width = bevel / max(sx, sy, sz)
    b.segments = 2
    b.limit_method = 'ANGLE'
    return o


# ---------------------------------------------------------------- vegetation
def tree_oak(name='oak', seed=1):
    r = random.Random(seed)
    parts = [part('t', cyl(10, 0.028, 0.018, 0.2), 'Bark', T(0, 0, 0.1))]
    blobs = [(0, 0, 0.27, 0.12), (0.06, 0.03, 0.23, 0.085), (-0.06, -0.02, 0.24, 0.09), (0.01, -0.06, 0.31, 0.08), (-0.02, 0.06, 0.32, 0.075)]
    for i, (x, y, z, rad) in enumerate(blobs):
        parts.append(part('c', sph(2, rad), ['Leaf', 'Leaf2', 'LeafDark'][i % 3], T(x, y, z), subsurf=1, displace=0.25, seed=seed + i))
    return join(name, parts)


def tree_pine(name='pine', seed=2):
    parts = [part('t', cyl(10, 0.025, 0.02, 0.14), 'Bark', T(0, 0, 0.07))]
    for i in range(5):
        z = 0.13 + i * 0.075
        rad = 0.14 - i * 0.024
        parts.append(part('c', cyl(14, rad, 0.0, 0.16 - i * 0.012), 'Pine' if i % 2 == 0 else 'Pine2', T(0, 0, z + 0.07), smooth=True))
    return join(name, parts)


def rock(name='rock', seed=3):
    return join(name, [part('r', sph(2, 0.1), 'Rock', T(0, 0, 0.03) @ S(1.3, 1, 0.7), subsurf=1, displace=0.35, seed=seed),
                       part('m', sph(2, 0.06), 'Moss', T(0.02, 0.01, 0.085) @ S(1.4, 1.1, 0.35), subsurf=1, displace=0.2, seed=seed + 9)])


def bush(name='bush', seed=4):
    return join(name, [part('b', sph(2, 0.07), 'LeafDark', T(0, 0, 0.04) @ S(1.3, 1.1, 0.8), subsurf=1, displace=0.3, seed=seed),
                       part('b', sph(2, 0.05), 'Leaf', T(0.05, 0.02, 0.05), subsurf=1, displace=0.3, seed=seed + 1)])


def sheep(name='sheep'):
    parts = []
    for i, (x, y, z) in enumerate([(0, 0, 0.1), (0.04, 0.02, 0.11), (-0.04, -0.02, 0.105), (0.02, -0.03, 0.12), (-0.03, 0.03, 0.12)]):
        parts.append(part('w', sph(2, 0.055), 'Wool', T(x, y, z), subsurf=1, displace=0.15, seed=i))
    parts.append(part('h', uvs(12, 8, 0.035), 'Face', T(0.095, 0, 0.13) @ S(1.3, 0.9, 1)))
    for sgn in (-1, 1):
        parts.append(part('e', uvs(8, 6, 0.015), 'Face', T(0.09, sgn * 0.035, 0.15) @ S(0.6, 1.6, 0.6)))
    for x in (-0.04, 0.045):
        for y in (-0.03, 0.03):
            parts.append(part('l', cyl(8, 0.011, 0.011, 0.07), 'Face', T(x, y, 0.035)))
    return join(name, parts)


def wheat_sheaf(name='sheaf'):
    parts = [part('s', cyl(16, 0.05, 0.03, 0.2), 'Straw', T(0, 0, 0.1)),
             part('s', cyl(16, 0.03, 0.065, 0.1), 'Straw2', T(0, 0, 0.24)),
             part('band', cyl(16, 0.053, 0.053, 0.02), 'Straw2', T(0, 0, 0.14))]
    return join(name, parts)


def hay_bale(name='hay'):
    o = part('h', cyl(20, 0.08, 0.08, 0.12), 'Straw', T(0, 0, 0.08) @ RX(math.pi / 2))
    b = o.modifiers.new('bev', 'BEVEL')
    b.width = 0.012
    b.segments = 3
    return join(name, [o])


def cactus(name='cactus'):
    parts = [part('c', cyl(12, 0.035, 0.03, 0.3), 'Cactus', T(0, 0, 0.15), subsurf=1),
             part('c', cyl(10, 0.022, 0.02, 0.1), 'Cactus', T(0.05, 0, 0.2) @ RY(-1.2), subsurf=1),
             part('c', cyl(10, 0.02, 0.018, 0.08), 'Cactus', T(-0.04, 0, 0.15) @ RY(1.1), subsurf=1)]
    return join(name, parts)


def crystal(name='crystal'):
    parts = []
    for i in range(5):
        a = i / 5 * math.pi * 2
        h = 0.12 + (i % 3) * 0.04
        parts.append(part('g', cyl(6, 0.035, 0.0, h), 'Gold', T(math.cos(a) * 0.045, math.sin(a) * 0.045, h / 2) @ RX(0.3 * math.cos(a)) @ RY(0.3 * math.sin(a)), smooth=False))
    parts.append(part('r', sph(2, 0.06), 'RockDark', T(0, 0, 0.0) @ S(1.4, 1.4, 0.6), subsurf=1, displace=0.3))
    return join(name, parts)


# ---------------------------------------------------------------- buildings
def gable_roof(name, mname, w, d, h, over=0.02):
    def g(bm):
        w2, d2 = w + over, d + over
        vs = [bm.verts.new(p) for p in [(-w2, -d2, 0), (w2, -d2, 0), (w2, d2, 0), (-w2, d2, 0), (0, -d2, h), (0, d2, h)]]
        for f in [(0, 1, 4), (3, 5, 2), (0, 4, 5, 3), (1, 2, 5, 4), (0, 3, 2, 1)]:
            bm.faces.new([vs[i] for i in f])
    return g


def house(name='house'):
    parts = [bevel_box('w', 'Plaster', 0.2, 0.15, 0.13, T(0, 0, 0.065)),
             bevel_box('b', 'Stone', 0.215, 0.165, 0.03, T(0, 0, 0.015)),
             part('r', gable_roof('r', 'Player', 0.1, 0.075, 0.1), 'Player', T(0, 0, 0.13), smooth=False),
             bevel_box('ch', 'Brick', 0.03, 0.03, 0.08, T(0.06, 0.04, 0.2)),
             bevel_box('d', 'Timber', 0.04, 0.012, 0.07, T(0, -0.076, 0.04)),
             bevel_box('wi', 'Glass', 0.03, 0.012, 0.03, T(-0.06, -0.076, 0.08)),
             bevel_box('wi', 'Glass', 0.03, 0.012, 0.03, T(0.06, -0.076, 0.08))]
    for x in (-0.1, 0.1):
        parts.append(bevel_box('tb', 'Timber', 0.012, 0.155, 0.012, T(x, 0, 0.12)))
    return join(name, parts)


def city(name='city'):
    parts = [bevel_box('base', 'Stone', 0.4, 0.3, 0.04, T(0, 0, 0.02)),
             bevel_box('keep', 'Stone', 0.16, 0.16, 0.34, T(-0.08, 0.02, 0.19)),
             part('kr', cyl(4, 0.13, 0.0, 0.16), 'Player', T(-0.08, 0.02, 0.44) @ RZ(math.pi / 4), smooth=False),
             bevel_box('hall', 'Plaster', 0.16, 0.12, 0.13, T(0.1, -0.03, 0.105)),
             part('hr', gable_roof('hr', 'Player', 0.085, 0.065, 0.08), 'Player', T(0.1, -0.03, 0.17), smooth=False)]
    for x, y in [(-0.17, -0.12), (0.17, -0.12), (0.17, 0.12), (-0.17, 0.12)]:
        parts.append(part('tw', cyl(16, 0.04, 0.04, 0.2), 'StoneDark', T(x, y, 0.12)))
        parts.append(part('tr', cyl(16, 0.05, 0.0, 0.09), 'Player', T(x, y, 0.265)))
    for sgn in (-1, 1):
        parts.append(bevel_box('wall', 'Stone', 0.34, 0.025, 0.08, T(0, sgn * 0.12, 0.08)))
        parts.append(bevel_box('wall', 'Stone', 0.025, 0.24, 0.08, T(sgn * 0.17, 0, 0.08)))
    for i in range(4):
        parts.append(bevel_box('cr', 'Stone', 0.028, 0.028, 0.03, T(-0.08 + (i % 2 - 0.5) * 0.11, 0.02 + (i // 2 - 0.5) * 0.11, 0.37)))
    parts.append(part('pole', cyl(8, 0.006, 0.006, 0.16), 'Timber', T(-0.08, 0.02, 0.58)))
    parts.append(bevel_box('flag', 'Player', 0.07, 0.006, 0.045, T(-0.045, 0.02, 0.63), bevel=0.002))
    return join(name, parts)


def road(name='road'):
    parts = [bevel_box('bed', 'Player', 0.56, 0.1, 0.035, T(0, 0, 0.018), bevel=0.012)]
    for i in range(6):
        parts.append(bevel_box('pl', 'Wood', 0.07, 0.12, 0.018, T(-0.225 + i * 0.09, 0, 0.042), bevel=0.005))
    return join(name, parts)


def robber(name='robber'):
    parts = [part('b', cyl(20, 0.12, 0.06, 0.34), 'Dark', T(0, 0, 0.17), subsurf=1),
             part('h', uvs(16, 10, 0.075), 'Dark', T(0, 0, 0.39)),
             part('hood', cyl(20, 0.09, 0.0, 0.14), 'Dark', T(0, -0.01, 0.46), subsurf=1),
             part('s', cyl(20, 0.085, 0.08, 0.035), 'Scarf', T(0, 0, 0.33), subsurf=1),
             part('bag', uvs(12, 8, 0.05), 'Cloth', T(0.08, 0.07, 0.18))]
    return join(name, parts)


def dock(name='dock'):
    parts = [bevel_box('deck', 'Wood', 0.5, 0.2, 0.025, T(0, 0, 0))]
    for i in range(6):
        parts.append(bevel_box('pl', 'Timber', 0.075, 0.21, 0.008, T(-0.21 + i * 0.084, 0, 0.015), bevel=0.003))
    for x in (-0.22, 0.22):
        for y in (-0.09, 0.09):
            parts.append(part('post', cyl(10, 0.018, 0.018, 0.3), 'Timber', T(x, y, -0.08)))
    return join(name, parts)


def boat(name='boat'):
    def hull(bm):
        prof = [(-0.2, 0.07, 0.06), (0.1, 0.075, 0.07), (0.24, 0.0, 0.09)]
        top, bot = [], []
        pts_top = [(-0.2, -0.07, 0.06), (0.1, -0.075, 0.065), (0.25, 0, 0.09), (0.1, 0.075, 0.065), (-0.2, 0.07, 0.06), (-0.23, 0, 0.065)]
        pts_bot = [(-0.17, -0.035, -0.02), (0.08, -0.04, -0.03), (0.2, 0, 0.0), (0.08, 0.04, -0.03), (-0.17, 0.035, -0.02), (-0.19, 0, -0.01)]
        top = [bm.verts.new(p) for p in pts_top]
        bot = [bm.verts.new(p) for p in pts_bot]
        n = len(top)
        for i in range(n):
            bm.faces.new((top[i], bot[i], bot[(i + 1) % n], top[(i + 1) % n]))
        bm.faces.new(list(reversed(top)))
        bm.faces.new(bot)
    h = part('hull', hull, 'Wood', subsurf=1)

    def sail(bm):
        vs = [bm.verts.new(p) for p in [(0.0, 0, 0.1), (0.0, 0, 0.45), (0.18, 0.03, 0.12)]]
        bm.faces.new(vs)
    return join(name, [h, part('mast', cyl(8, 0.008, 0.006, 0.44), 'Timber', T(0, 0, 0.26)),
                       part('sail', sail, 'Cloth', smooth=False)])


# ---------------------------------------------------------------- tile improvements (Civ-like)
def windmill(name='windmill'):
    parts = [part('tower', cyl(16, 0.07, 0.05, 0.3), 'Plaster', T(0, 0, 0.15)),
             part('cap', cyl(16, 0.065, 0.0, 0.1), 'Timber', T(0, 0, 0.35))]
    for i in range(4):
        parts.append(bevel_box('blade', 'Cloth', 0.02, 0.006, 0.16, T(0.075, 0, 0.3) @ RX(i * math.pi / 2) @ T(0, 0, 0.09), bevel=0.002))
    return join(name, parts)


def kiln(name='kiln'):
    parts = [part('dome', uvs(18, 10, 0.1), 'Brick', T(0, 0, 0.02) @ S(1, 1, 0.9), subsurf=0),
             bevel_box('chim', 'Brick', 0.035, 0.035, 0.12, T(0.05, 0, 0.14)),
             bevel_box('door', 'Dark', 0.04, 0.02, 0.05, T(0, -0.095, 0.03))]
    for i in range(3):
        parts.append(bevel_box('stack', 'Brick', 0.07, 0.035, 0.03, T(0.14, -0.05 + i * 0.0, 0.015 + i * 0.03), bevel=0.004))
    return join(name, parts)


def mine(name='mine'):
    parts = [part('rock', sph(2, 0.14), 'RockDark', T(0, 0, 0.02) @ S(1.3, 1, 0.8), subsurf=1, displace=0.3),
             bevel_box('frame', 'Timber', 0.12, 0.02, 0.015, T(0, -0.12, 0.13)),
             bevel_box('post', 'Timber', 0.015, 0.02, 0.12, T(-0.05, -0.12, 0.06)),
             bevel_box('post', 'Timber', 0.015, 0.02, 0.12, T(0.05, -0.12, 0.06)),
             bevel_box('hole', 'Dark', 0.085, 0.01, 0.1, T(0, -0.118, 0.05)),
             bevel_box('cart', 'Metal', 0.06, 0.04, 0.035, T(0.12, -0.16, 0.03))]
    return join(name, parts)


def lumber(name='lumber'):
    parts = [bevel_box('hut', 'Wood', 0.14, 0.1, 0.08, T(0, 0, 0.04)),
             part('roof', gable_roof('r', 'Timber', 0.075, 0.055, 0.06), 'Timber', T(0, 0, 0.08), smooth=False)]
    for i in range(3):
        parts.append(part('log', cyl(10, 0.018, 0.018, 0.14), 'Bark', T(0.12, -0.05 + i * 0.038, 0.02) @ RX(math.pi / 2)))
    return join(name, parts)


def fence(name='fence'):
    parts = [bevel_box('rail', 'Wood', 0.3, 0.01, 0.012, T(0, 0, 0.05), bevel=0.003), bevel_box('rail', 'Wood', 0.3, 0.01, 0.012, T(0, 0, 0.025), bevel=0.003)]
    for x in (-0.14, 0, 0.14):
        parts.append(bevel_box('p', 'Timber', 0.015, 0.015, 0.07, T(x, 0, 0.035), bevel=0.003))
    return join(name, parts)


builders = [tree_oak, tree_pine, rock, bush, sheep, wheat_sheaf, hay_bale, cactus, crystal, house, city, road, robber, dock, boat,
            windmill, kiln, mine, lumber, fence]
for i, fn in enumerate(builders):
    o = fn()
    o.location = ((i % 5) * 2, (i // 5) * 2, 0)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True)
print('EXPORTED', OUT, sorted(o.name for o in bpy.data.objects))
