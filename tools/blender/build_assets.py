# Procedural low-poly asset kit for Catan x Kchudites (Bad North / Civ-like diorama style).
# Run headless:  blender --background --python tools/blender/build_assets.py -- assets/models/kit.glb
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'kit.glb'
random.seed(1337)
bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MATS = {}


def mat(name, hexcol, rough=0.92, metal=0.0, emit=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(hexcol), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(hexcol), 1)
        b.inputs['Emission Strength'].default_value = emit
    MATS[name] = m
    return m


# Palette: soft, desaturated Bad North tones; "Top"/"Player" are white and tinted at runtime.
P = dict(
    Top=('#ffffff',), Cliff=('#9a8a72',), CliffDark=('#7d6f5c',), Sand=('#e9dcb5',),
    Trunk=('#6e5039',), Pine=('#3f6f4a',), PineLight=('#4f8456',), Leaf=('#6e9b52',),
    Rock=('#8e9098',), RockDark=('#6f7179',), Snow=('#f4f6fa',), Wool=('#f3f1ea',), Face=('#2d2a2c',),
    Wheat=('#e3b64c',), WheatDark=('#c9962e',), Clay=('#b8643e',), Brick=('#a44a31',),
    Cactus=('#5e8c4a',), Gold=('#ffcf4a', 0.35, 0.8), Wall=('#efe4cc',), Roof=('#ffffff',), Player=('#ffffff',),
    Wood=('#8a6242',), Cloth=('#f7f1e3',), Dark=('#2b2a33',), Scarf=('#d8453b',), Water=('#5aa6b8',),
)


class Builder:
    """Accumulates parts into one bmesh; each part carries a material slot."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []

    def slot(self, mname):
        if mname not in self.slots:
            self.slots.append(mname)
        return self.slots.index(mname)

    def add(self, geom_fn, mname, M=Matrix.Identity(4), jitter=0.0, smooth=False):
        tmp = bmesh.new()
        geom_fn(tmp)
        if jitter:
            for v in tmp.verts:
                v.co += Vector((random.uniform(-jitter, jitter), random.uniform(-jitter, jitter), random.uniform(-jitter, jitter)))
        bmesh.ops.transform(tmp, matrix=M, verts=tmp.verts)
        idx = self.slot(mname)
        mesh = bpy.data.meshes.new('tmp')
        tmp.to_mesh(mesh)
        tmp.free()
        # merge into main bmesh
        offset = len(self.bm.verts)
        self.bm.from_mesh(mesh)
        self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces:
            if all(v.index >= offset for v in f.verts) or f.material_index == 0 and getattr(f, '_new', True):
                pass
        bpy.data.meshes.remove(mesh)
        # faces created from this part are the last ones; tag by vertex index
        self.bm.verts.index_update()
        for f in self.bm.faces:
            if min(v.index for v in f.verts) >= offset:
                f.material_index = idx
                f.smooth = smooth
        return self

    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for s in self.slots:
            args = P[s]
            mesh.materials.append(mat(s, *args))
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


T = lambda x=0, y=0, z=0: Matrix.Translation((x, y, z))
S = lambda x, y=None, z=None: Matrix.Diagonal((x, y if y is not None else x, z if z is not None else x, 1))
RZ = lambda a: Matrix.Rotation(a, 4, 'Z')
RX = lambda a: Matrix.Rotation(a, 4, 'X')


def cone(seg, r1, r2, d):
    return lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=d)


def cube(s=1.0):
    return lambda bm: bmesh.ops.create_cube(bm, size=s)


def ico(sub, r):
    return lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)


def hex_ring(r, z, rot=math.pi / 2):
    return [Vector((r * math.cos(rot + i * math.pi / 3), r * math.sin(rot + i * math.pi / 3), z)) for i in range(6)]


# ---------------------------------------------------------------- tile (cliff column)
def tile_geom(bm):
    rings = []
    levels = [0.0, -0.1, -0.35, -0.62, -1.0]
    radii = [0.985, 0.975, 0.99, 0.965, 1.02]
    SUB = 3  # vertices per hex side, for a craggy silhouette
    for li, (z, r) in enumerate(zip(levels, radii)):
        ring = []
        corners = hex_ring(r, z)
        for i in range(6):
            a, b = corners[i], corners[(i + 1) % 6]
            for k in range(SUB):
                p = a.lerp(b, k / SUB)
                if 0 < li < len(levels) - 1:
                    d = Vector((p.x, p.y, 0)).normalized() * random.uniform(-0.035, 0.03)
                    p = p + d + Vector((0, 0, random.uniform(-0.03, 0.03)))
                ring.append(bm.verts.new(p))
        rings.append(ring)
    n = len(rings[0])
    for li in range(len(rings) - 1):
        for i in range(n):
            bm.faces.new((rings[li][i], rings[li + 1][i], rings[li + 1][(i + 1) % n], rings[li][(i + 1) % n]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))


def build_tile():
    b = Builder('tile')
    b.add(tile_geom, 'Cliff')
    obj = b.finish()
    # top face + first band -> Top material; alternate strata colours on the cliff
    me = obj.data
    top_i = me.materials.find('Cliff')
    me.materials.append(mat('Top', *P['Top']))
    me.materials.append(mat('CliffDark', *P['CliffDark']))
    for poly in me.polygons:
        zs = [me.vertices[v].co.z for v in poly.vertices]
        zc = sum(zs) / len(zs)
        if zc > -0.06:
            poly.material_index = 1  # Top (grass lip)
        elif -0.5 < zc < -0.2:
            poly.material_index = 2
        else:
            poly.material_index = top_i
    return obj


# ---------------------------------------------------------------- nature
def build_pine(name='pine', h=1.0):
    b = Builder(name)
    b.add(cone(6, 0.035, 0.03, 0.14), 'Trunk', T(0, 0, 0.07))
    for i, (z, r) in enumerate([(0.2, 0.15), (0.32, 0.12), (0.43, 0.085)]):
        b.add(cone(7, r, 0.0, 0.2), 'Pine' if i % 2 == 0 else 'PineLight', T(0, 0, z) @ RZ(i * 0.7), jitter=0.008)
    return b.finish()


def build_round_tree():
    b = Builder('tree')
    b.add(cone(6, 0.03, 0.025, 0.16), 'Trunk', T(0, 0, 0.08))
    b.add(ico(1, 0.13), 'Leaf', T(0, 0, 0.26) @ S(1, 1, 0.9), jitter=0.02)
    return b.finish()


def build_mountain():
    b = Builder('mountain')
    b.add(cone(7, 0.42, 0.0, 0.75), 'Rock', T(0, 0, 0.375), jitter=0.035)
    b.add(cone(7, 0.17, 0.0, 0.28), 'Snow', T(0, 0, 0.62), jitter=0.015)
    b.add(cone(6, 0.26, 0.0, 0.42), 'RockDark', T(0.3, -0.12, 0.21), jitter=0.03)
    return b.finish()


def build_rock():
    b = Builder('rock')
    b.add(ico(0, 0.1), 'Rock', T(0, 0, 0.04) @ S(1.2, 1, 0.7), jitter=0.02)
    return b.finish()


def build_sheep():
    b = Builder('sheep')
    b.add(ico(1, 0.08), 'Wool', T(0, 0, 0.1) @ S(1.35, 1, 0.95), jitter=0.01)
    b.add(cube(0.07), 'Face', T(0.11, 0, 0.13))
    for x in (-0.05, 0.05):
        for y in (-0.035, 0.035):
            b.add(cube(0.022), 'Face', T(x, y, 0.03) @ S(1, 1, 2.2))
    return b.finish()


def build_wheat():
    b = Builder('wheat')
    for i in range(7):
        a = i / 7 * math.pi * 2
        r = 0.035 if i else 0
        b.add(cone(4, 0.018, 0.0, 0.24), 'Wheat' if i % 2 else 'WheatDark', T(math.cos(a) * r, math.sin(a) * r, 0.12) @ RX(random.uniform(-0.2, 0.2)))
    b.add(cone(6, 0.03, 0.03, 0.03), 'WheatDark', T(0, 0, 0.1))
    return b.finish()


def build_clay():
    b = Builder('clay')
    b.add(ico(1, 0.22), 'Clay', T(0, 0, -0.04) @ S(1.2, 1, 0.45), jitter=0.02)
    for i, (x, y, z) in enumerate([(0.18, 0.12, 0.03), (0.26, 0.12, 0.03), (0.22, 0.12, 0.08)]):
        b.add(cube(1), 'Brick', T(x, y, z) @ S(0.075, 0.04, 0.04))
    return b.finish()


def build_cactus():
    b = Builder('cactus')
    b.add(cone(6, 0.035, 0.03, 0.3), 'Cactus', T(0, 0, 0.15))
    b.add(cone(6, 0.022, 0.02, 0.12), 'Cactus', T(0.05, 0, 0.18) @ RX(0) @ Matrix.Rotation(-0.9, 4, 'Y'))
    b.add(cone(6, 0.02, 0.018, 0.1), 'Cactus', T(-0.045, 0, 0.13) @ Matrix.Rotation(0.9, 4, 'Y'))
    return b.finish()


def build_crystal():
    b = Builder('crystal')
    for i in range(4):
        a = i / 4 * math.pi * 2
        h = 0.14 + i * 0.03
        b.add(cone(5, 0.045, 0.0, h), 'Gold', T(math.cos(a) * 0.05, math.sin(a) * 0.05, h / 2) @ RX(0.25 * (i - 1.5)))
    return b.finish()


# ---------------------------------------------------------------- pieces
def prism_roof(w, d, h):
    def g(bm):
        vs = [bm.verts.new(p) for p in [(-w, -d, 0), (w, -d, 0), (w, d, 0), (-w, d, 0), (0, -d, h), (0, d, h)]]
        bm.faces.new((vs[0], vs[1], vs[4]))
        bm.faces.new((vs[3], vs[5], vs[2]))
        bm.faces.new((vs[0], vs[4], vs[5], vs[3]))
        bm.faces.new((vs[1], vs[2], vs[5], vs[4]))
        bm.faces.new((vs[0], vs[3], vs[2], vs[1]))
    return g


def build_house():
    b = Builder('house')
    b.add(cube(1), 'Wall', T(0, 0, 0.07) @ S(0.2, 0.15, 0.14))
    b.add(prism_roof(0.12, 0.095, 0.11), 'Player', T(0, 0, 0.14))
    b.add(cube(1), 'Trunk', T(0.1, -0.02, 0.2) @ S(0.03, 0.03, 0.08))
    b.add(cube(1), 'Dark', T(0, -0.076, 0.045) @ S(0.045, 0.01, 0.07))
    return b.finish()


def build_city():
    b = Builder('city')
    b.add(cube(1), 'Wall', T(0, 0, 0.07) @ S(0.34, 0.24, 0.14))
    b.add(cube(1), 'Wall', T(-0.08, 0, 0.19) @ S(0.15, 0.15, 0.38))
    b.add(cone(4, 0.13, 0.0, 0.17), 'Player', T(-0.08, 0, 0.465) @ RZ(math.pi / 4))
    b.add(prism_roof(0.1, 0.13, 0.1), 'Player', T(0.1, 0, 0.14) @ RZ(math.pi / 2))
    for x in (-0.15, -0.04, 0.07, 0.15):
        b.add(cube(1), 'Wall', T(x, -0.12, 0.16) @ S(0.035, 0.03, 0.05))
    b.add(cube(1), 'Trunk', T(-0.08, 0, 0.6) @ S(0.012, 0.012, 0.12))
    b.add(cube(1), 'Player', T(-0.05, 0, 0.63) @ S(0.06, 0.008, 0.04))
    return b.finish()


def build_road():
    b = Builder('road')
    b.add(cube(1), 'Player', T(0, 0, 0.03) @ S(0.56, 0.11, 0.05))
    for x in (-0.2, 0, 0.2):
        b.add(cube(1), 'Wood', T(x, 0, 0.06) @ S(0.05, 0.13, 0.02))
    return b.finish()


def build_robber():
    b = Builder('robber')
    b.add(cone(8, 0.14, 0.07, 0.34), 'Dark', T(0, 0, 0.17))
    b.add(ico(1, 0.085), 'Dark', T(0, 0, 0.4))
    b.add(cone(8, 0.1, 0.1, 0.035), 'Scarf', T(0, 0, 0.33))
    b.add(cone(6, 0.09, 0.0, 0.1), 'Dark', T(0, 0, 0.5))
    return b.finish()


def build_dock():
    b = Builder('dock')
    b.add(cube(1), 'Wood', T(0, 0, 0.0) @ S(0.5, 0.18, 0.03))
    for x in (-0.22, 0.22):
        for y in (-0.08, 0.08):
            b.add(cone(5, 0.02, 0.02, 0.22), 'Trunk', T(x, y, -0.06))
    return b.finish()


def build_boat():
    b = Builder('boat')

    def hull(bm):
        top = [bm.verts.new(p) for p in [(-0.2, -0.07, 0.06), (0.14, -0.07, 0.06), (0.24, 0, 0.07), (0.14, 0.07, 0.06), (-0.2, 0.07, 0.06)]]
        bot = [bm.verts.new(p) for p in [(-0.17, -0.04, -0.02), (0.12, -0.04, -0.02), (0.2, 0, 0.0), (0.12, 0.04, -0.02), (-0.17, 0.04, -0.02)]]
        n = len(top)
        for i in range(n):
            bm.faces.new((top[i], bot[i], bot[(i + 1) % n], top[(i + 1) % n]))
        bm.faces.new(list(reversed(top)))
        bm.faces.new(bot)
    b.add(hull, 'Wood')
    b.add(cone(5, 0.008, 0.008, 0.36), 'Trunk', T(0, 0, 0.24))

    def sail(bm):
        vs = [bm.verts.new(p) for p in [(0.01, 0, 0.1), (0.01, 0, 0.4), (0.16, 0, 0.12)]]
        bm.faces.new(vs)
        vs2 = [bm.verts.new(p) for p in [(0.01, 0.002, 0.1), (0.16, 0.002, 0.12), (0.01, 0.002, 0.4)]]
        bm.faces.new(vs2)
    b.add(sail, 'Cloth')
    return b.finish()


builders = [build_tile, build_pine, build_round_tree, build_mountain, build_rock, build_sheep, build_wheat,
            build_clay, build_cactus, build_crystal, build_house, build_city, build_road, build_robber, build_dock, build_boat]
for i, fn in enumerate(builders):
    o = fn()
    o.location.x = (i % 6) * 3  # spread out (ignored at runtime: we reset positions)
    o.location.y = (i // 6) * 3
    for p in o.data.polygons:
        p.use_smooth = False

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
print('EXPORTED', OUT, [o.name for o in bpy.data.objects])
