# Baseline hiệu năng (Giai đoạn 0)

Đo trong Node bằng `pnpm build && pnpm baseline` (script `scripts/baseline.ts`). Chưa đo FPS, `renderer.info`, thời gian `buildStatic` hay `render()` UI: những số đó cần Chrome DevTools (CPU throttle 4x/6x), xem plan.

- Máy: Apple M4, 10 lõi, Node v22.22.0, darwin/arm64
- Ngày đo: 2026-11-10

## Sim bot

300 ván bot đấu bot (`runSim(300)`, kèm kiểm tra bất biến sau mỗi hành động): **2620 ms** (trung vị của 3 lần: 2618 / 2620 / 2798 ms).

## generateBoard theo hình dạng (ms/lần, trung bình 50 lần)

| Hình dạng | cỡ mặc định | cỡ 40 |
|---|---|---|
| classic | 0.048 | 0.055 |
| mini | 0.046 | 0.032 |
| extended | 0.100 | 0.088 |
| big | 0.135 | 0.103 |
| huge | 0.214 | 0.191 |
| ring | 0.087 | 0.087 |
| star | 0.095 | 0.090 |
| kingdoms | 0.103 | 0.095 |
| islands | 0.332 | 0.724 |
| pangea | 0.195 | 0.446 |

## Bundle

Tổng `dist/`: **5055.7 KB** (74 file)

| Chunk | Kích thước | gzip |
|---|---|---|
| assets/three-Adn5Ggow.js | 644.5 KB | 162.5 KB |
| assets/index-DP1CPik7.js | 189.6 KB | 67.4 KB |
| assets/peerjs-CuigyuOk.js | 90.9 KB | 25.2 KB |
| assets/index-wkKplaDM.css | 57.5 KB | 12.8 KB |
| assets/board3d-FEe50X7b.js | 53.8 KB | 20.5 KB |
| assets/rolldown-runtime-XKyaHtl9.js | 0.7 KB | 0.4 KB |

Theo nhóm: models 1500.7 KB, textures 2010.7 KB, icons 9.5 KB, font 496.6 KB (gồm cả bản `.woff` dự phòng mà trình duyệt hiện đại không tải).
