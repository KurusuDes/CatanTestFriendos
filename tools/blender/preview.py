import bpy, sys, math
out = sys.argv[sys.argv.index('--') + 1]
glb = sys.argv[sys.argv.index('--') + 2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for i, o in enumerate(sorted(objs, key=lambda o: o.name)):
    o.location = ((i % 4) * 1.3 - 2, -(i // 4) * 1.1 + 1.6, 0)
    if o.name == 'tile': o.scale = (0.5, 0.5, 0.5)
    for m in o.data.materials:
        if m and m.name in ('Top', 'Player', 'Roof'):
            m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.2, 0.5, 0.9, 1) if m.name != 'Top' else (0.4, 0.7, 0.3, 1)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
cam.location = (0, -5.5, 5.2); cam.rotation_euler = (math.radians(45), 0, 0); cam.data.lens = 32
bpy.context.scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (0.7, 0.2, 0.5); bpy.context.scene.collection.objects.link(sun)
w = bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.7, 0.8, 1)
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE_NEXT'; sc.render.resolution_x = 1000; sc.render.resolution_y = 800; sc.render.filepath = out
bpy.ops.render.render(write_still=True)
