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

---

# Sau refactor (Giai đoạn 6)

Đo lại bằng `pnpm build && pnpm baseline` trên cùng máy (Apple M4, Node v22.22.0) ngày 2026-11-11, sau khi chuyển toàn bộ sang TypeScript strict + Preact và dọn dẹp. Vẫn chưa đo FPS/`renderer.info` trong trình duyệt.

## So sánh

| Chỉ số | Trước | Sau | Ghi chú |
|---|---|---|---|
| Sim 300 ván (trung vị 3 lần) | 2620 ms | 2697 ms | cùng mức, sai khác nằm trong nhiễu đo |
| generateBoard classic (mặc định) | 0.048 ms | 0.088 ms | trung bình 50 lần, nhiễu lớn ở mức dưới 0.1 ms; các hình khác giống trước (islands 0.33 → 0.37, pangea 0.20 → 0.21) |
| Tổng `dist/` | 5055.7 KB (74 file) | 5061.5 KB (79 file) | thêm 2 worker và các chunk tách nhỏ |
| three (chunk riêng) | 644.5 KB / gzip 162.5 | 736.3 KB / gzip 184.8 | three nâng lên 0.187, vẫn tách riêng và chỉ tải cùng bàn cờ 3D |
| Chunk chính `index` | 189.6 KB / gzip 67.4 | 241.7 KB / gzip 87.4 | thêm Preact, Signals, Comlink và toàn bộ giao diện viết lại bằng TSX |
| peerjs (tải lười) | 90.9 KB / gzip 25.2 | 90.9 KB / gzip 25.2 | không đổi |
| Board3D (tải lười) | 53.8 KB / gzip 20.5 | 83.4 KB / gzip 30.9 | gồm tầng chất lượng, render theo nhu cầu, địa hình qua worker |
| Worker | không có | terrain 17.2 KB, texture 4.4 KB | địa hình/texture dựng ngoài luồng chính |
| CSS | 57.5 KB / gzip 12.8 | 58.9 KB / gzip 13.1 | |
| models | 1500.7 KB | 923.7 KB | nén meshopt (`pnpm assets`) |
| textures | 2010.7 KB | 2397.9 KB | thêm bản thấp cho tier "Máy yếu" |
| font | 496.6 KB | 496.6 KB | Be Vietnam Pro + Baloo 2 qua @fontsource |

Cảnh báo build: trước có `INEFFECTIVE_DYNAMIC_IMPORT` (engine/game, engine/config) và cảnh báo chunk lớn hơn 500 kB; sau dọn dẹp build không còn cảnh báo nào (`chunkSizeWarningLimit: 800` cho chunk `three`).
