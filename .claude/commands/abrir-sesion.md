---
description: Mở phiên làm việc ở Katanittes (trạng thái, việc tồn đọng và kế hoạch trong ngày)
argument-hint: "[việc tùy chọn]"
---

Mở phiên làm việc:

1. **Trạng thái.** Dùng Active Context và các việc đang mở mà hook SessionStart đã đưa vào. Nếu chúng không có trong ngữ cảnh, đọc `CatanVault/01 - Active Context.md` và `CatanVault/02 - Tareas.md`.
2. **Những gì còn dang dở.** Chạy `git status -sb` và `git log origin/main..HEAD --oneline`. Nếu có thay đổi chưa commit hoặc commit chưa push từ phiên trước, nói điều đó trước tiên.
3. **Tóm tắt cho tôi** (tối đa 150 từ):
   - trạng thái hiện tại trong 2-3 dòng;
   - các việc tồn đọng trong `02 - Tareas.md`, việc quan trọng nhất đứng trước (tối đa 6; nếu nhiều hơn thì cho biết tổng số);
   - phần dang dở ở bước 2, nếu có.
4. **Việc hôm nay:** $ARGUMENTS
   - Nếu có việc: dựa vào `CatanVault/00 - Index.md` để xác định file nào bị ảnh hưởng và đề xuất một kế hoạch ngắn (bạn làm gì, tôi quyết định gì).
   - Nếu không có: gợi ý 2-3 việc tồn đọng để bắt đầu và hỏi tôi chọn việc nào.
5. Không sửa code cho đến khi tôi xác nhận kế hoạch.
