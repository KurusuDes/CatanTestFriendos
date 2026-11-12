---
description: Đóng phiên: ghi lại tiến độ vào vault Obsidian, tạo các việc tồn đọng, commit và push
---

Đóng phiên làm việc:

1. **Đã làm gì.** Đọc `CatanVault/01 - Active Context (VI).md` để lấy «Commit gần nhất đã ghi tài liệu», rồi chạy:
   - `git log --reverse --format='%h %s' <hash đó>..HEAD`
   - `git status --porcelain`
   Kết hợp với những gì ta đã trao đổi trong cuộc trò chuyện này (các yêu cầu, quyết định của tôi, điều đã được kiểm chứng và điều chưa).
2. **Số phiên.** Xem `CatanVault/Sesiones/`: phiên mới là số kế tiếp số cao nhất (`S01`, `S02`...).
3. **Ghi chú phiên.** Tạo `CatanVault/Sesiones/S{NN} - {AAAA-MM-DD} - {tiêu đề ngắn}.md` theo cùng định dạng với các ghi chú trước:
   - frontmatter gồm `tags: [sesion]`, `fecha` và `commits`;
   - đã làm gì, chia theo khối, kèm hash của từng commit;
   - các quyết định do tôi đưa ra (giữ nguyên lời tôi nếu quan trọng);
   - kiểm chứng: test, ảnh chụp, những gì chưa được thử;
   - các file đã động đến, chỉ những file quan trọng.
   Viết cho người không có mặt trong phiên: câu đầy đủ, không dùng biệt ngữ nội bộ.
4. **Việc cần làm.** Trong `CatanVault/02 - Tareas (VI).md`:
   - đánh dấu hoàn thành (`- [x] ... ✅ ngày [[S{NN} ...]]`, chuyển xuống mục «Hechas») những việc đã xong;
   - tạo các việc tồn đọng mới (`- [ ] ... ➕ ngày [[S{NN} ...]]`) từ: những thứ chưa kiểm chứng, ý tưởng để lại sau, yêu cầu của tôi chưa làm, bug đã thấy mà chưa sửa. Mỗi việc một dòng, có thể hành động ngay. Nếu không có thì đừng bịa ra.
5. **Active Context.** Viết lại `CatanVault/01 - Active Context (VI).md`: phiên gần nhất (kèm liên kết), «Commit gần nhất đã ghi tài liệu» (commit làm việc cuối cùng của phiên này, trước commit đóng phiên), trạng thái trong một đoạn và bước tiếp theo.
6. **Chỉ mục.** Nếu kiến trúc thay đổi (file hoặc hệ thống mới), cập nhật bảng trong `CatanVault/00 - Index (VI).md`.
7. **Test.** Nếu còn code chưa commit, chạy `pnpm test`. Nếu lỗi thì đừng push: giữ nguyên commit đã tạo và báo tôi.
8. **Commit và push.** `git add -A`, commit với thông điệp `S{NN}: tóm tắt` (phần thân gồm các gạch đầu dòng theo khối; trailer `Co-Authored-By` và `Claude-Session` lấy từ system-reminder) rồi `git push origin main`. Lưu ý: push sẽ xuất bản game lên Vercel (https://hex-island.vercel.app). Nếu push lỗi, giữ nguyên commit và báo lại.
9. **Báo cáo** (tối đa 120 từ): hash commit, ghi chú đã tạo, các việc đã đóng và đã tạo, bước tiếp theo. Không nhắc lại phiên: nó đã nằm trong ghi chú.
