---
tags: [index, vi]
---

# Katanittes — Mục lục (Tiếng Việt)

Bản dịch của [[00 - Index]].

Game xây dựng định cư lấy cảm hứng từ Catan, chạy trên trình duyệt (Vite + TypeScript + Preact, build ra trang tĩnh), có bản đồ tùy chỉnh, chế độ riêng, bot, online P2P và bản đồ 3D dạng mô hình với giao diện pixel art. Chỉ có tiếng Việt. Trước đây tên là Katan x Amiguites và Catan x Kchudites.

- **Chơi:** https://hex-island.vercel.app (Vercel từ `main`: mỗi lần push là xuất bản)
- **Repo:** https://github.com/phuonglat142/Hex-Island

## Các ghi chú trong vault
- [[01 - Active Context (VI)]] — hiện đang ở đâu và bước tiếp theo (viết lại sau mỗi lần đóng phiên)
- [[02 - Tareas (VI)]] — việc tồn đọng và việc đã xong
- `Sesiones/` — mỗi phiên làm việc một ghi chú ([[S00 - Historia previa]] tóm tắt mọi thứ trước khi có vault)

## Bản đồ mã nguồn

| Khu vực | Tệp | Làm gì |
|---|---|---|
| Engine | `src/engine/game.ts`, `board.ts`, `constants.ts`, `config.ts`, `rng.ts`, `types.ts` | Luật thuần: `applyAction(state, action)` kiểm tra và áp dụng; hiệu ứng hình ảnh xuất ra ở `state.fx`; lịch sử và lỗi là chuỗi thường (`@3` = người chơi số 3). Không bao giờ import `app/`, `ui/`, `net/`, `board/` |
| Bot | `src/engine/bot.ts` | 3 cấp độ; `botAct(state, pid)` trả về hành động; `hint` cho gợi ý 💡 |
| App | `src/app/` (`index.ts`, `store.ts`, `persist.ts`, `events.ts`), `src/main.ts` | Trạng thái ván chơi, `dispatch`, lượt của bot, phản ứng (`emote`) và đánh dấu (`ping`), lưu ván; `main.ts` là điểm vào |
| Online | `src/net/` (`host.ts`, `client.ts`, `session.ts`, `redact.ts`, `messages.ts`) | PeerJS/WebRTC: host áp dụng mọi hành động và gửi lại trạng thái đã lọc thông tin ẩn (`redactFor`); kết nối lại bằng token, bỏ phiếu khi ngắt kết nối, phòng |
| Màn hình | `src/ui/screens/` (`Menu`, `Lobby`, `Online`, `Editor`, `Help`, `Diorama`) | Preact + Signals: menu, sảnh/phòng, trình chỉnh sửa bản đồ, trợ giúp |
| Ván chơi (UI) | `src/ui/game/` | Thẻ người chơi, bài trên tay, hành động, nút xúc xắc có nạp lực, phản ứng, hiệu ứng (`fx.ts`) và bài bay; `controller.ts` nối store với bàn cờ |
| Bản đồ 3D | `src/board/` (`Board3D.ts`, `terrain*.ts`, `pieces.ts`, `fog.ts`, `dice3d.ts`, `quality.ts`...), `src/workers/` | three.js: địa hình (sinh trong worker), quân cờ, sương mù, xúc xắc 3D, cờ hiệu, bong bóng chat; mức chất lượng Cực đẹp/Cao/Vừa/Máy yếu; vẽ theo nhu cầu; biến thể diện mạo theo chất liệu (`TILE_LOOKS`) |
| ADHD | `src/ui/adhd/` | Minigame để giết thời gian chờ (Plinko, máy đánh bạc, đồng xu, đua cừu, mỏ đá, tên lửa): số dư theo từng người chơi, mở khóa theo mục tiêu, Auto, trong suốt và không bấm được khi đến lượt bạn; thắng là hành động `adhdWin` (pháo hoa, dải thông báo và vàng trên quân cờ) |
| UI chung | `src/ui/components/`, `src/ui/flag/`, `pixel.ts`, `sfx.ts`, `dom.ts`, `iconset.ts` | Thành phần dùng chung, cờ, sprite pixel, âm thanh tổng hợp, tiện ích DOM; `dom.ts` chuyển các khóa cũ `kchudites.*` |
| Giao diện | `src/styles/style.css`, `src/styles/pixel.css` | Chủ đề pixel (bảng màu Sweetie-16); font Be Vietnam Pro + Baloo 2 qua @fontsource |
| Tài nguyên | `public/assets/`, `tools/source/`, `tools/optimize-assets.mjs`, `tools/blender/*.py` | Texture, `kit.glb` (nén meshopt) và icon; `pnpm assets` sinh lại bản tối ưu, xem `docs/assets.md` |
| Script | `scripts/` | `sim`, `determinism`, `baseline`, `coverage`, `check-imports`, `verify-kit`, `bench-terrain` |
| Test | `tests/` | `pnpm test` (vitest): luật, 300 ván bot đấu bot với các bất biến, redact, bàn cờ, giao diện, quy ước import |
| Tài liệu | `README.md`, `NOTICE.md`, `docs/` | README, giấy phép bên thứ ba, pipeline asset, baseline hiệu năng (có phần "Sau refactor") |
| Quy trình làm việc | `.claude/commands/`, `.claude/hooks/session-start.mjs`, `.claude/settings.json` | `/abrir-sesion`, `/cerrar-sesion` và hook nạp Active Context cùng các việc tồn đọng khi bắt đầu |

## Cách làm việc
- Chạy local: `pnpm install`, rồi `pnpm dev` và mở địa chỉ Vite in ra (mặc định http://localhost:5173/)
- Trước khi push: `pnpm typecheck`, `pnpm test` và `pnpm build`; sau khi sửa engine hoặc bot, chạy thêm `pnpm determinism 200`
- `/abrir-sesion [việc]` khi bắt đầu, `/cerrar-sesion` khi kết thúc (ghi tài liệu ở đây, tạo việc, commit và push)
