# Procedural, tileable PBR-ish textures (albedo + normal) generated with numpy and saved
# through Blender's image API (no external downloads, everything is ours).
# Run:  blender --background --python tools/blender/make_textures.py -- <repo>/assets/textures
import sys, os, math
import numpy as np
import bpy

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)
N = 512
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- noise helpers (all tileable)
def spectral(n=N, beta=2.0, seed=0, lo=1.0, aniso=(1.0, 1.0)):
    """Fractal noise by FFT filtering: periodic by construction."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((n, n))
    fx = np.fft.fftfreq(n)[None, :] * aniso[0]
    fy = np.fft.fftfreq(n)[:, None] * aniso[1]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    amp = 1.0 / np.power(np.maximum(f * n, lo), beta / 2)
    amp[0, 0] = 0
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    out -= out.min()
    return out / out.max()


def cells(n=N, count=60, seed=0, jitter=1.0):
    """Tileable Worley F1/F2 distances."""
    r = np.random.default_rng(seed)
    pts = r.random((count, 2)) * n
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    f1 = np.full((n, n), 1e9, np.float32)
    f2 = np.full((n, n), 1e9, np.float32)
    for px, py in pts:
        dx = np.abs(xx - px)
        dy = np.abs(yy - py)
        dx = np.minimum(dx, n - dx)
        dy = np.minimum(dy, n - dy)
        d = np.sqrt(dx * dx + dy * dy)
        f2 = np.where(d < f1, f1, np.minimum(f2, d))
        f1 = np.minimum(f1, d)
    return f1 / f1.max(), f2 / f2.max()


def ramp(t, stops):
    """t in [0,1] -> rgb using [(pos, '#hex')...]"""
    t = np.clip(t, 0, 1)
    pos = np.array([p for p, _ in stops])
    cols = np.array([[int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)] for _, c in stops])
    out = np.zeros(t.shape + (3,))
    for k in range(3):
        out[..., k] = np.interp(t, pos, cols[:, k])
    return out


def normal_from_height(h, strength=4.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def save(name, rgb, fmt='JPEG', quality=88):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels = px[::-1].ravel()  # blender images are bottom-up
    img.filepath_raw = os.path.join(OUT, name)
    img.file_format = fmt
    bpy.context.scene.render.image_settings.quality = quality
    img.save()
    print('saved', name, w, h)


def shade(rgb, h, ao=0.35):
    """darken crevices using the height itself (cheap cavity map)"""
    return rgb * (1 - ao + ao * h[..., None])


# ---------------------------------------------------------------- terrain layers
layers = {}

# 0 grass
g = spectral(beta=2.2, seed=1)
blades = spectral(beta=0.9, seed=2, aniso=(1.0, 0.25))
clumps = spectral(beta=3.0, seed=3)
hgt = 0.5 * blades + 0.3 * g + 0.2 * clumps
alb = ramp(g * 0.6 + clumps * 0.4, [(0, '#3f6526'), (0.45, '#5b8a34'), (0.75, '#78a444'), (1, '#9bb85a')])
alb = shade(alb, blades, 0.45)
alb += (spectral(beta=0.3, seed=4) > 0.93)[..., None] * np.array([0.25, 0.22, 0.05])  # yellow specks
layers['grass'] = (alb, hgt, 3.0)

# 1 forest floor (moss, needles, twigs)
m = spectral(beta=2.0, seed=11)
needles = spectral(beta=0.7, seed=12, aniso=(0.3, 1.0))
alb = ramp(m, [(0, '#27391c'), (0.4, '#3a5226'), (0.7, '#4d4a2a'), (1, '#5f5433')])
alb = shade(alb, needles, 0.5)
layers['forest'] = (alb, 0.6 * needles + 0.4 * m, 3.5)

# 2 dirt / clay with pebbles
d = spectral(beta=2.1, seed=21)
f1, _ = cells(count=140, seed=22)
pebble = np.clip(1 - f1 * 9, 0, 1)
alb = ramp(d, [(0, '#5e3a26'), (0.5, '#8a5638'), (1, '#b06e45')])
alb = alb * (1 - pebble[..., None] * 0.2) + pebble[..., None] * np.array([0.55, 0.48, 0.42]) * 0.35
layers['dirt'] = (shade(alb, d, 0.3), d * 0.6 + pebble * 0.6, 4.0)

# 3 rock (strata + cracks)
r1 = spectral(beta=2.3, seed=31)
warp = spectral(beta=2.5, seed=32)
yy = np.mgrid[0:N, 0:N][0] / N
strata = 0.5 + 0.5 * np.sin((yy * 6 + warp * 1.2) * 2 * math.pi)
f1, f2 = cells(count=16, seed=33)
cracks = np.clip((f2 - f1) * 40, 0, 1)
fine = spectral(beta=1.1, seed=34)
hgt = 0.4 * r1 + 0.4 * strata + 0.1 * cracks + 0.1 * fine
alb = ramp(0.5 * r1 + 0.35 * strata + 0.15 * fine, [(0, '#545049'), (0.45, '#7a746a'), (0.75, '#9a9283'), (1, '#b7ad9b')])
alb = alb * (0.82 + 0.18 * cracks[..., None])
layers['rock'] = (alb, hgt, 6.0)

# 4 sand with ripples
s = spectral(beta=1.4, seed=41)
wv = spectral(beta=3.0, seed=42)
xx = np.mgrid[0:N, 0:N][1] / N
rip = 0.5 + 0.5 * np.sin((xx * 22 + wv * 3) * 2 * math.pi)
alb = ramp(0.6 * s + 0.4 * wv, [(0, '#c9ae7c'), (0.5, '#dcc592'), (1, '#ecdcb0')])
layers['sand'] = (shade(alb, rip, 0.15), 0.5 * rip + 0.5 * s, 2.0)

# 5 snow
sn = spectral(beta=2.4, seed=51)
alb = ramp(sn, [(0, '#c9d3e0'), (0.5, '#e6ecf3'), (1, '#fbfcfd')])
layers['snow'] = (alb, sn, 2.0)

# 6 field (ripe wheat)
st = spectral(beta=0.8, seed=61, aniso=(0.15, 1.0))
fl = spectral(beta=2.0, seed=62)
alb = ramp(0.5 * st + 0.5 * fl, [(0, '#9c7426'), (0.4, '#c69a3a'), (0.75, '#dcb656'), (1, '#efd580')])
layers['field'] = (shade(alb, st, 0.45), st, 3.0)

# 7 meadow (bright pasture with flowers)
mg = spectral(beta=2.0, seed=71)
bl = spectral(beta=0.9, seed=72, aniso=(1.0, 0.3))
alb = ramp(mg, [(0, '#5a8c32'), (0.5, '#78aa42'), (1, '#9cc25c')])
alb = shade(alb, bl, 0.4)
fw = spectral(beta=0.2, seed=73)
alb = np.where((fw > 0.965)[..., None], np.array([0.97, 0.95, 0.9]), alb)
alb = np.where(((fw < 0.03))[..., None], np.array([0.95, 0.8, 0.25]), alb)
layers['meadow'] = (alb, 0.6 * bl + 0.4 * mg, 3.0)

order = ['grass', 'forest', 'dirt', 'rock', 'sand', 'snow', 'field', 'meadow']
alb_strip = np.concatenate([layers[k][0] for k in order], 0)
nrm_strip = np.concatenate([normal_from_height(layers[k][1], layers[k][2]) for k in order], 0)
save('terrain_albedo.jpg', alb_strip, quality=86)
save('terrain_normal.jpg', nrm_strip, quality=90)

# ---------------------------------------------------------------- water + clouds
w1 = spectral(beta=2.6, seed=81)
w2 = spectral(beta=1.6, seed=82, aniso=(1.0, 0.6))
save('water_normal.jpg', normal_from_height(0.7 * w1 + 0.3 * w2, 5.0), quality=90)
c = spectral(n=256, beta=3.2, seed=91)
save('clouds.jpg', np.repeat(c[..., None], 3, -1), quality=85)

# ---------------------------------------------------------------- model textures (256px)
M = 256
def sp(**kw):
    return spectral(n=M, **kw)

# bark: vertical fibres
b = sp(beta=0.8, seed=101, aniso=(1.0, 0.12))
save('bark.jpg', shade(ramp(b, [(0, '#3b2a1e'), (0.6, '#5e4431'), (1, '#7a5b41')]), b, 0.5))
# leaves: clustered dappled foliage
lf = sp(beta=1.2, seed=111)
lc, lc2 = cells(n=M, count=700, seed=112)
leaf = np.clip(1 - lc * 2.2, 0, 1) ** 0.5 * (0.7 + 0.3 * np.clip((lc2 - lc) * 20, 0, 1))
alb = ramp(0.55 * lf + 0.45 * leaf, [(0, '#223d18'), (0.45, '#3f6a27'), (0.8, '#5f8f36'), (1, '#8fb652')])
save('leaves.jpg', shade(alb, leaf, 0.5))
# pine needles
pn = sp(beta=0.7, seed=121, aniso=(0.2, 1.0))
save('pine.jpg', shade(ramp(pn, [(0, '#18321f'), (0.5, '#2c5234'), (1, '#4a7a4a')]), pn, 0.45))
# roof tiles (grey-white, tinted per player at runtime)
yy, xx = np.mgrid[0:M, 0:M] / M
row = np.floor(yy * 8)
tile_y = (yy * 8) % 1
tile_x = (xx * 8 + (row % 2) * 0.5) % 1
edge = np.clip(np.minimum(np.minimum(tile_x, 1 - tile_x) * 8, tile_y * 6), 0, 1)
tn = sp(beta=1.5, seed=131)
roof = (0.55 + 0.35 * tile_y + 0.1 * tn) * (0.55 + 0.45 * edge)
save('roof.jpg', np.repeat(roof[..., None], 3, -1) * np.array([1.0, 0.97, 0.94]))
# stone blocks
brow = np.floor(yy * 6)
bx = (xx * 4 + (brow % 2) * 0.5) % 1
by = (yy * 6) % 1
mortar = np.clip(np.minimum(np.minimum(bx, 1 - bx) * 14, np.minimum(by, 1 - by) * 10), 0, 1)
sn2 = sp(beta=2.0, seed=141)
blockTone = np.floor(xx * 4 + (brow % 2) * 0.5) * 0.37 + brow * 0.71
bt = (np.sin(blockTone * 12.9898) * 43758.5453) % 1
stone = ramp(0.6 * sn2 + 0.4 * bt, [(0, '#7d766b'), (0.5, '#a39b8d'), (1, '#c4bcab')]) * (0.45 + 0.55 * mortar[..., None])
save('stone.jpg', stone)
# plaster with timber frame hint
pl = sp(beta=1.8, seed=151)
save('plaster.jpg', ramp(pl, [(0, '#d9ccb2'), (0.6, '#ebe0c9'), (1, '#f6efdf')]))
# planks
pk = sp(beta=0.6, seed=161, aniso=(0.08, 1.0))
seams = np.clip(np.minimum((xx * 5) % 1, 1 - (xx * 5) % 1) * 30, 0, 1)
save('planks.jpg', ramp(pk, [(0, '#5b3d27'), (0.5, '#80583a'), (1, '#a07550')]) * (0.5 + 0.5 * seams[..., None]))
# rock for props
rk = sp(beta=2.2, seed=171)
f1s, f2s = cells(n=M, count=30, seed=172)
save('rockprop.jpg', ramp(rk, [(0, '#5d5a55'), (0.5, '#86817a'), (1, '#aaa397')]) * (0.88 + 0.12 * np.clip((f2s - f1s) * 30, 0, 1))[..., None])
# wool
wl = sp(beta=0.6, seed=181)
save('wool.jpg', ramp(wl, [(0, '#cfc8b8'), (0.5, '#ebe6da'), (1, '#fbf9f3')]))
# light painted planks (tinted with the player colour at runtime)
pp = sp(beta=0.6, seed=191, aniso=(0.08, 1.0))
pseams = np.clip(np.minimum((xx * 4) % 1, 1 - (xx * 4) % 1) * 30, 0, 1)
save('paint.jpg', np.repeat((0.72 + 0.22 * pp)[..., None], 3, -1) * (0.55 + 0.45 * pseams[..., None]))
# fired bricks
brow2 = np.floor(yy * 10)
bx2 = (xx * 5 + (brow2 % 2) * 0.5) % 1
by2 = (yy * 10) % 1
mort2 = np.clip(np.minimum(np.minimum(bx2, 1 - bx2) * 16, np.minimum(by2, 1 - by2) * 9), 0, 1)
bt2 = (np.sin((np.floor(xx * 5 + (brow2 % 2) * 0.5) * 0.37 + brow2 * 0.71) * 12.9898) * 43758.5453) % 1
bn = sp(beta=1.8, seed=201)
brick = ramp(0.5 * bt2 + 0.5 * bn, [(0, '#7a3322'), (0.5, '#9e4a30'), (1, '#b86644')])
save('bricks.jpg', brick * mort2[..., None] + np.array([0.72, 0.68, 0.6]) * (1 - mort2[..., None]))
print('DONE')
