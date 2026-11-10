// @ts-nocheck
// Đo baseline phần đo được trong Node (không cần trình duyệt). Chạy: pnpm build && pnpm baseline
// Ghi kết quả vào docs/perf-baseline.md
import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { runSim } from './sim.ts';
import { generateBoard, SHAPES } from '../src/engine/board.js';
import { defaultConfig } from '../src/engine/config.js';

const ms = (t0: number) => performance.now() - t0;
const quiet = <T>(fn: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};

// 1. sim 300 ván (chạy 1 lần làm nóng, đo 3 lần lấy trung vị)
quiet(() => runSim(20));
const simTimes: number[] = [];
for (let k = 0; k < 3; k++) {
  const t0 = performance.now();
  quiet(() => runSim(300));
  simTimes.push(ms(t0));
}
simTimes.sort((a, b) => a - b);
const simMs = simTimes[1]!;

// 2. generateBoard theo từng hình dạng bản đồ (cỡ mặc định + cỡ 40), 50 lần mỗi loại
const shapes = Object.keys(SHAPES).filter(k => k !== 'custom');
const rows: string[] = [];
for (const shape of shapes) {
  const cell = (size: number) => {
    const cfg = defaultConfig();
    cfg.map.shape = shape;
    cfg.map.size = size;
    for (let i = 0; i < 5; i++) generateBoard(cfg, { s: 1 + i });
    const N = 50;
    const t0 = performance.now();
    let tiles = 0;
    for (let i = 0; i < N; i++) tiles = Object.keys(generateBoard(cfg, { s: 100 + i }).tiles ?? {}).length || tiles;
    return { t: ms(t0) / N, tiles };
  };
  const a = cell(defaultConfig().map.size);
  const b = cell(40);
  rows.push(`| ${shape} | ${a.t.toFixed(3)} | ${b.t.toFixed(3)} |`);
}

// 3. kích thước dist/
const walk = (dir: string, out: { path: string; size: number; gz: number }[] = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push({ path: p, size: statSync(p).size, gz: /\.(js|css|html)$/.test(f) ? gzipSync(readFileSync(p)).length : 0 });
  }
  return out;
};
let distSection = '_Chưa có `dist/`: chạy `pnpm build` rồi `pnpm baseline`._\n';
if (existsSync('dist')) {
  const files = walk('dist');
  const total = files.reduce((a, f) => a + f.size, 0);
  const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';
  const chunks = files.filter(f => /\.(js|css)$/.test(f.path)).sort((a, b) => b.size - a.size);
  const group = (re: RegExp) => files.filter(f => re.test(f.path)).reduce((a, f) => a + f.size, 0);
  distSection =
    `Tổng \`dist/\`: **${kb(total)}** (${files.length} file)\n\n` +
    `| Chunk | Kích thước | gzip |\n|---|---|---|\n` +
    chunks.map(f => `| ${f.path.replace('dist/', '')} | ${kb(f.size)} | ${kb(f.gz)} |`).join('\n') +
    `\n\nTheo nhóm: models ${kb(group(/dist\/assets\/models\//))}, textures ${kb(group(/dist\/assets\/textures\//))}, icons ${kb(group(/dist\/assets\/icons\//))}, font ${kb(group(/\.(woff2?)$/))} (gồm cả bản \`.woff\` dự phòng mà trình duyệt hiện đại không tải).\n`;
}

const md = `# Baseline hiệu năng (Giai đoạn 0)

Đo trong Node bằng \`pnpm build && pnpm baseline\` (script \`scripts/baseline.ts\`). Chưa đo FPS, \`renderer.info\`, thời gian \`buildStatic\` hay \`render()\` UI: những số đó cần Chrome DevTools (CPU throttle 4x/6x), xem plan.

- Máy: ${os.cpus()[0]?.model}, ${os.cpus().length} lõi, Node ${process.version}, ${process.platform}/${process.arch}
- Ngày đo: ${new Date().toISOString().slice(0, 10)}

## Sim bot

300 ván bot đấu bot (\`runSim(300)\`, kèm kiểm tra bất biến sau mỗi hành động): **${simMs.toFixed(0)} ms** (trung vị của 3 lần: ${simTimes.map(t => t.toFixed(0)).join(' / ')} ms).

## generateBoard theo hình dạng (ms/lần, trung bình 50 lần)

| Hình dạng | cỡ mặc định | cỡ 40 |
|---|---|---|
${rows.join('\n')}

## Bundle

${distSection}`;
mkdirSync('docs', { recursive: true });
writeFileSync('docs/perf-baseline.md', md);
console.log(md);
