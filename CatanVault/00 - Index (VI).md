---
tags: [index, vi]
---

# Katanittes — Mục lục (Tiếng Việt)

Bản dịch của [[00 - Index]].

Game xây dựng định cư lấy cảm hứng từ Catan, chạy trên trình duyệt (trang tĩnh, không cần build), có bản đồ tùy chỉnh, chế độ riêng, bot, online P2P và bản đồ 3D dạng mô hình với giao diện pixel art. Có sáu ngôn ngữ (Tây Ban Nha, Anh, Bồ Đào Nha, Pháp, Đức và Ý). Trước đây tên là Katan x Amiguites và Catan x Kchudites.

- **Chơi:** https://kurusudes.github.io/CatanTestFriendos/ (GitHub Pages từ `main`: mỗi lần push là xuất bản)
- **Repo:** https://github.com/KurusuDes/CatanTestFriendos

## Các ghi chú trong vault
- [[01 - Active Context (VI)]] — hiện đang ở đâu và bước tiếp theo (viết lại sau mỗi lần đóng phiên)
- [[02 - Tareas (VI)]] — việc tồn đọng và việc đã xong
- `Sesiones/` — mỗi phiên làm việc một ghi chú ([[S00 - Historia previa]] tóm tắt mọi thứ trước khi có vault)

## Bản đồ mã nguồn

| Khu vực | Tệp | Làm gì |
|---|---|---|
| Engine | `js/engine/game.js`, `board.js`, `constants.js`, `config.js`, `rng.js` | Luật thuần: `applyAction(state, action)` kiểm tra và áp dụng; hiệu ứng hình ảnh xuất ra ở `state.fx`; lịch sử và lỗi đi dưới dạng mẫu câu + giá trị (`msg`) để mỗi client tự dịch |
| Bot | `js/engine/bot.js` | 3 cấp độ; `botAct(state, pid)` trả về hành động; `hint` cho gợi ý 💡 |
| App | `js/app.js`, `js/main.js` | Trạng thái ván chơi, `dispatch`, lượt của bot, phản ứng (`emote`) và đánh dấu (`ping`) |
| Online | `js/net.js` | PeerJS/WebRTC: host áp dụng mọi hành động và gửi lại trạng thái; kết nối lại bằng token, bỏ phiếu khi ngắt kết nối, phòng |
| Ván chơi (UI) | `js/ui/gameView.js` | Thẻ người chơi, bài trên tay, hành động, nút xúc xắc có nạp lực, phản ứng, hiệu ứng (`handleFx`) và bài bay giữa tay, người chơi và ngân hàng (`flyCard`) |
| Bản đồ 3D | `js/ui/board3d.js`, `dice3d.js` | three.js: địa hình, quân cờ, sương mù, xúc xắc 3D, cờ hiệu của nút giữa, bong bóng chat; biến thể diện mạo theo chất liệu (`TILE_LOOKS`) |
| ADHD | `js/ui/adhd.js` | Minigame để giết thời gian chờ (Plinko, máy đánh bạc, đồng xu, đua cừu, mỏ đá, tên lửa): số dư theo từng người chơi, mở khóa theo mục tiêu, Auto, trong suốt và không bấm được khi đến lượt bạn; thắng là hành động `adhdWin` (pháo hoa, dải thông báo và vàng trên quân cờ) |
| UI còn lại | `js/ui/lobby.js`, `editor.js`, `flag.js`, `pixel.js`, `sfx.js`, `help.js`, `dom.js` | Menu/phòng, trình chỉnh sửa bản đồ, cờ, sprite pixel, âm thanh tổng hợp, trợ giúp và credit; `dom.js` chuyển các khóa cũ `kchudites.*` |
| Ngôn ngữ | `js/i18n.js`, `js/i18n/*.js`, `tools/i18n.mjs` | Tiếng Tây Ban Nha là văn bản gốc: `t()` dịch, `tx()` dịch thông điệp của engine; mỗi ngôn ngữ một từ điển; `node tools/i18n.mjs check` cho biết còn thiếu gì |
| Giao diện | `css/style.css`, `css/pixel.css` | Chủ đề pixel (bảng màu Sweetie-16) |
| Tài nguyên | `assets/`, `tools/blender/*.py` | Texture, `kit.glb` và icon tạo bằng script Blender |
| Test | `tests/rules.mjs`, `tests/sim.mjs` | `npm test`: luật + 300 ván bot đấu bot với các bất biến |
| Showcase và trailer | `showcase/` | Showcase (`index.html`, `showcase.js`) và trailer châm biếm ES/EN (`trailer.html`, `trailer.js`, `?lang=en`), tiện ích dùng chung ở `motion.js`; video MP4 quay từng khung hình; GIF trailer cho Reddit ở `showcase/reddit/` |
| Quy trình làm việc | `.claude/commands/`, `.claude/hooks/session-start.mjs`, `.claude/settings.json` | `/abrir-sesion`, `/cerrar-sesion` và hook nạp Active Context cùng các việc tồn đọng khi bắt đầu |

## Cách làm việc
- Chạy local: `py -m http.server 8123` rồi mở http://localhost:8123/ (trên máy này `python` mở Microsoft Store; `py` mới là Python 3.14 thật)
- Trước khi push: `npm test`
- `/abrir-sesion [việc]` khi bắt đầu, `/cerrar-sesion` khi kết thúc (ghi tài liệu ở đây, tạo việc, commit và push)
