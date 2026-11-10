// Sinh lại toàn bộ asset đã tối ưu. Chạy: pnpm assets
//  - tools/source/kit.glb  ->  public/assets/models/kit.glb   (gltfpack: meshopt, KHÔNG quantization)
//  - public/assets/textures/{terrain_albedo,terrain_normal,water_normal,clouds}.jpg -> .../low/
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tex = join(root, 'public/assets/textures');
const low = join(tex, 'low');
const JPEG_Q = 85;

const report = [];
function size(path) {
  const b = readFileSync(path);
  return { raw: b.length, gz: gzipSync(b, { level: 9 }).length };
}
function log(name, from, to) {
  const a = size(from);
  const b = size(to);
  report.push(`${name}: ${kb(a.raw)} (gzip ${kb(a.gz)}) -> ${kb(b.raw)} (gzip ${kb(b.gz)})`);
}
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

// ---------- 1. kit.glb ----------
// -cc: nén meshopt (EXT_meshopt_compression), -noq: không quantization (shader gió cần position.y local gốc),
// -kn: giữ node có tên (kit[o.name]), -km: giữ vật liệu có tên (code tra theo tên). Texture giữ nguyên.
function buildKit() {
  const src = join(root, 'tools/source/kit.glb');
  const dst = join(root, 'public/assets/models/kit.glb');
  mkdirSync(dirname(dst), { recursive: true });
  const cli = require.resolve('gltfpack/cli.js');
  execFileSync(process.execPath, [cli, '-i', src, '-o', dst, '-cc', '-noq', '-kn', '-km', '-kv'], { stdio: 'inherit' });
  log('models/kit.glb', src, dst);
}

// ---------- 2. texture low ----------
// Dải dọc N lớp vuông (rộng w, cao N*w). Resize từng lớp riêng để không lem giữa các lớp.
async function resizeStrip(name, layers, layerPx, { normal = false } = {}) {
  const src = join(tex, name);
  const { width, height } = await sharp(src).metadata();
  const w = width;
  const lh = height / layers;
  const out = [];
  for (let i = 0; i < layers; i++) {
    const { data } = await sharp(src)
      .extract({ left: 0, top: i * lh, width: w, height: lh })
      .removeAlpha()
      .resize(layerPx, Math.round((lh * layerPx) / w), { kernel: 'lanczos3', fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (normal) renormalize(data);
    out.push(data);
  }
  const buf = Buffer.concat(out);
  const h = Math.round((lh * layerPx) / w) * layers;
  const dst = join(low, name);
  await sharp(buf, { raw: { width: layerPx, height: h, channels: 3 } })
    .jpeg({ quality: JPEG_Q, chromaSubsampling: normal ? '4:4:4' : '4:2:0' })
    .toFile(dst);
  log(`textures/low/${name} (${layerPx}x${h})`, src, dst);
}

function renormalize(px) {
  for (let i = 0; i < px.length; i += 3) {
    let x = px[i] / 127.5 - 1;
    let y = px[i + 1] / 127.5 - 1;
    let z = px[i + 2] / 127.5 - 1;
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    px[i] = Math.round((x * 0.5 + 0.5) * 255);
    px[i + 1] = Math.round((y * 0.5 + 0.5) * 255);
    px[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
  }
}

async function halve(name, { normal = false } = {}) {
  const src = join(tex, name);
  const { width, height } = await sharp(src).metadata();
  const w = width >> 1;
  const h = height >> 1;
  const { data } = await sharp(src)
    .removeAlpha()
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (normal) renormalize(data);
  const dst = join(low, name);
  await sharp(data, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: JPEG_Q, chromaSubsampling: normal ? '4:4:4' : '4:2:0' })
    .toFile(dst);
  log(`textures/low/${name} (${w}x${h})`, src, dst);
}

buildKit();
mkdirSync(low, { recursive: true });
await resizeStrip('terrain_albedo.jpg', 8, 256);
await resizeStrip('terrain_normal.jpg', 8, 256, { normal: true });
await halve('water_normal.jpg', { normal: true });
await halve('clouds.jpg');

console.log('\n' + report.join('\n'));
