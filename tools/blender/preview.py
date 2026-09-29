import bpy, sys, math
out = sys.argv[sys.argv.index('--') + 1]
glb = sys.argv[sys.argv.index('--') + 2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = sorted([o for o in bpy.context.scene.objects if o.type == 'MESH'], key=lambda o: o.name)
for i, o in enumerate(objs):
    o.location = ((i % 5) * 0.62 - 1.24, -(i // 5) * 0.6 + 0.9, 0)
    o.scale = (1.6, 1.6, 1.6)
    for m in o.data.materials:
        if m and m.name == 'Player':
            m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.7, 0.08, 0.06, 1)
bpy.ops.mesh.primitive_plane_add(size=6); bpy.context.object.data.materials.append(bpy.data.materials.new('g'))
bpy.context.object.data.materials[0].diffuse_color = (0.35, 0.5, 0.25, 1)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
cam.location = (0, -3.3, 2.6); cam.rotation_euler = (math.radians(52), 0, 0); cam.data.lens = 30
bpy.context.scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (0.8, 0.2, 0.6); bpy.context.scene.collection.objects.link(sun)
w = bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.72, 0.8, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE_NEXT'; sc.render.resolution_x = 1200; sc.render.resolution_y = 800; sc.render.filepath = out
bpy.ops.render.render(write_still=True)
