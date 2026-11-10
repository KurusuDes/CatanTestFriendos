# Pipeline asset

Asset gốc nằm ở `tools/source/`; bản tối ưu nằm ở `public/assets/` và được sinh lại bằng một lệnh:

```
pnpm assets        # chạy tools/optimize-assets.mjs (xác định: chạy lại cho cùng hash)
pnpm verify:kit    # so sánh kit.glb nén với bản gốc (cũng chạy trong pnpm test)
```

## kit.glb (mô hình)

`tools/source/kit.glb` (không nén) -> `public/assets/models/kit.glb`, dùng `gltfpack` (WASM, devDependency):

```
gltfpack -i tools/source/kit.glb -o public/assets/models/kit.glb -cc -noq -kn -km -kv
```

- `-cc`: nén meshopt (`EXT_meshopt_compression`). Loader phải gọi `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`.
- `-noq`: KHÔNG quantization. Shader gió dùng `position.y` local của mesh; `KHR_mesh_quantization` đổi toạ độ local nên sẽ làm hỏng hiệu ứng.
- `-kn`: giữ node có tên (code tra `kit[o.name]`: road, house, city...), giữ cây node/transform tương đương.
- `-km`: giữ vật liệu có tên (Player, Banner, Leaf...), không gộp vật liệu.
- `-kv`: giữ attribute không dùng (vd. `uv` ở vật liệu không có texture) để tập attribute giống hệt bản gốc.
- Texture nhúng giữ nguyên (không re-encode, không KTX2). Texture KTX2 để giai đoạn sau.

gltfpack chỉ gộp đỉnh trùng khít và bỏ tam giác suy biến (diện tích 0); `pnpm verify:kit` kiểm tra vị trí đỉnh (qua ma trận world), bbox, tên node/vật liệu, `map` của vật liệu.

## Texture bản thấp (tier chất lượng thấp)

Sinh vào `public/assets/textures/low/` bằng `sharp`:

- `terrain_albedo.jpg`, `terrain_normal.jpg`: dải dọc 8 lớp, mỗi lớp 512 -> 256 px (256x2048), resize từng lớp riêng (không lem giữa lớp). Normal map được chuẩn hoá lại vector từng pixel sau khi resize.
- `water_normal.jpg`, `clouds.jpg`: nửa độ phân giải (water_normal chuẩn hoá lại).
- JPEG quality 85.

Nguồn của texture là file cùng tên ngay trong `public/assets/textures/`.

## Thêm prop mới từ Blender

1. Thêm builder vào `tools/blender/build_assets.py`, chạy để xuất `kit.glb` (node cấp 1 đặt tên đúng như code tra, vật liệu đặt tên).
2. Chép file xuất ra đè `tools/source/kit.glb`.
3. `pnpm assets` rồi `pnpm verify:kit` (nếu thêm node mới, bản gốc vẫn so với bản nén nên vẫn chạy được).
4. Commit cả `tools/source/kit.glb` và `public/assets/models/kit.glb`.
