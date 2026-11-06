# Mặt bằng từ bản vẽ PDF

Sinh ảnh nền `apps/admin/public/plans/*.png` và khối số liệu trong
`packages/map-core/src/sample/lanPlans.ts` từ bộ bản vẽ "HE THONG LAN - MAT BANG KHONG DAY.pdf"
(14 trang, xuất từ CAD qua matplotlib — toàn bộ là nét vector).

Cần Python 3 + `pymupdf numpy pillow` (nên dùng venv riêng).

```bash
python export.py <thư mục chứa reg.py> <thư mục ảnh ra> params.json   # ảnh + ../result.json
python gen_ts.py <result.json> packages/map-core/src/sample/lanPlans.ts
```

- `reg.py` — đọc PDF (biến môi trường `HWN_PLANS_PDF`, mặc định `~/Downloads/HE THONG LAN - MAT BANG
  KHONG DAY.pdf`), raster hoá, khớp ảnh bằng tương quan chéo (FFT).
- `params.json` — tỉ lệ (m / pt) từng trang, tỉ lệ sơ đồ tổng thể `s_ov`, góc xoay từng toà,
  danh sách trang của mỗi toà (trang đầu = tầng tham chiếu).
- `export.py` — cắt từng trang (bỏ tiêu đề), lưu PNG 16 mức xám (cạnh dài ≤ 4096 px, ≥ 2 cm / px),
  khớp các tầng với tầng tham chiếu (lệch `offset`), khớp tầng tham chiếu với sơ đồ tổng thể
  (vị trí + góc xoay của toà trên khuôn viên).
- `gen_ts.py` — ghi khối `// @generated-plans-*` (tên tầng, số tầng, cao độ đặt trong `META`).

Tường, vách, cột, cửa, thang, dốc (`packages/map-core/src/sample/plans/*.json`, đọc trong
`planStructure.ts`). Cần thêm `opencv-python-headless`.

```bash
python walls.py result.json params.json <thư mục ra> [số trang …]   # vài phút cho cả 13 tầng
python pack.py <thư mục ra> packages/map-core/src/sample/plans    # lọc, làm tròn, sửa đa giác
```

Bản vẽ không có layer (mọi nét đen, cùng độ dày) nên nhận dạng theo hình học (`walls.py`,
`features.py`):

- Tường: cặp nét song song cách nhau 4,5–45 cm, giữa không có nét khác. Trước đó bỏ nét đứt /
  gạch chấm (trục lưới thường chạy giữa lòng tường). Chuỗi ≥ 3 cặp cách đều, cùng chiều dài
  (bậc thang, hatch, khung kính) bị loại; mẩu ngắn đứng riêng, ô vuông nhỏ (ký hiệu ổ mạng), mảnh
  mỏng dính vào tường dày hơn và đường ghi kích thước cũng bị loại. Đầu tường kéo tới tâm tường
  vuông góc.
- Cửa sổ: hai đoạn tường thẳng hàng cùng độ dày, khe 0,2–6 m giữa chúng có ≥ 2 nét song song nằm
  trong bề dày tường phủ gần hết khe (khung kính) → nối thành một tường, khe ghi thành cửa sổ
  (`windows` trong JSON, bậu 0,9 m). Khe không có nét (lối đi, chỗ giao tường) giữ nguyên.
- Vách nét đơn: nét đơn có chấm tròn đều dọc theo (≥ 2 chấm, ≤ 1,6 m / chấm) → vách ngăn nhẹ dày
  0,1 m.
- Cột: khối tô đặc chữ nhật 18–130 cm (bỏ khối hình thoi / tam giác của ký hiệu cửa), vòng tròn
  trong ô vuông (không có chữ — ký hiệu trục), ô chữ nhật 0,2–0,9 m có nét gạch chéo.
- Cửa: khe 0,6–2,6 m giữa hai đoạn tường thẳng hàng, có cung cánh cửa quét từ dọc tường tới vuông
  góc, bán kính ≈ độ rộng khe (1 cánh) hoặc ½ (2 cánh).
- Thang bộ: ≥ 5 vạch bậc song song cách đều 0,15–0,47 m, các vế kề nhau gộp lại. Thang cuốn: dải
  hẹp (≤ 1,7 m), dài (≥ 4,5 m), ≥ 15 bậc.
- Thang máy: buồng có dấu X kèm thanh đối trọng bên cạnh, hoặc buồng chữ nhật có thanh đối trọng
  (2–3 nét sát nhau) ngay trên cạnh. Ô X không có thanh đối trọng (hộp kỹ thuật) bị bỏ qua.
- Dốc: vùng nét chéo đan hai hướng (gạch hình thoi), rộng ≥ 1,5 m và đặc (không phải dải mỏng
  dọc tường) — đường bao lấy theo vùng (dốc cong giữ dáng; đa giác tự cắt thay bằng bao lồi).
- Tường / cột nằm trong thang, dốc bị bỏ. Thang / dốc cùng loại chồng nhau ≥ 50 % ở hai tầng kề
  nhau được nối chung `linkId` (`linkPlanConnectors`).
- Thang bộ nằm trong sân trong (khung `COURTYARDS` trong `lanPlans.ts`, đo tay trên bản vẽ tầng 1)
  là bậc từ sân lên tầng 1, không phải thang nối tầng → chuyển thành bậc thang ngoài trời của toà
  (`Building.exterior.paths`, loại `steps`, chân ở phía tâm sân). Chênh cao để mặc định.

Đã biết: mép sân trong (nét đôi có ô X ở góc) vẫn ra tường; cửa lùa, cửa không vẽ cung và cửa
chống cháy (ký hiệu hình thoi) chưa nhận được — ra khe hở trên tường.

Cách lấy tỉ lệ:

- Trang có đường ghi kích thước (mm): hồi quy `độ dài nét = giá trị / tỉ lệ + phần vượt` trên mọi
  cặp (chữ số, đường kích thước) — phần vượt (~3–9 pt) là đoạn đường kích thước thò quá vạch
  dóng; bỏ qua nó sẽ lệch tỉ lệ ~4 %.
- Trang không có kích thước (khoa chống nhiễm khuẩn, dinh dưỡng, khoa lây tầng 1): quét tỉ lệ khi
  khớp với sơ đồ tổng thể. Khoa lây tầng 2: khớp với tầng 1. Kiểm tra chéo: khoảng cột hành lang
  của các khoa ra ≈ 3,2 m, đúng với kích thước ghi trên bản vẽ giải phẫu bệnh.
