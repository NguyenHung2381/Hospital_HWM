# HWN – Client web chỉ đường trong nhà

Monorepo (npm workspaces) gồm 2 app React và các package dùng chung.

```
apps/
  user/          App người dùng (mobile-first): định vị bằng ảnh, tìm phòng, chỉ đường   → :5173
  admin/         App quản lý: bản đồ, khoa phòng, lưu lượng                                → :5174
packages/
  map-core/      Mô hình dữ liệu bản đồ, hình học, kiểm tra hợp lệ, tìm đường, dữ liệu mẫu
  api-client/    Hợp đồng REST API (đường dẫn + DTO) và client axios có kiểu
  mock-api/      Mock server (MSW) chạy ngay trong trình duyệt — không cần backend
  map-render/    Hiển thị bản đồ 2D (Konva) và 3D (three.js) — chỉ đọc, dùng chung 2 app
```

## Hiển thị bản đồ (`@hwn/map-render`)

| Thành phần                              | Dùng khi                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `MapViewer`                             | Cần bản đồ hoàn chỉnh: chọn tầng, chuyển 2D/3D, thu phóng, tuyến đường, vị trí người dùng       |
| `FloorPlan2D`                           | Chỉ cần mặt bằng 2D của một tầng                                                                |
| `MapStage` + các lớp trong `layers.tsx` | Tự ghép giao diện riêng (vd. editor admin): pan/zoom/pinch + phòng, tường, thang, đồ thị, tuyến |
| `Building3D` (`@hwn/map-render/3d`)     | Cảnh 3D. `MapViewer` tự tải lười phần này nên three.js chỉ được tải khi bấm "3D"                |

```tsx
<MapViewer building={building} route={route} location={myLocation} highlightRoomId={roomId} />
```

Màu nút điều khiển chỉnh qua CSS variables `--hwn-map-accent`, `--hwn-map-surface`, …;
màu canvas chỉnh qua prop `theme` (`'auto' | 'light' | 'dark' | MapTheme`).

## Bắt đầu

Yêu cầu Node ≥ 22.

```bash
npm install
npm run dev:user     # http://localhost:5173
npm run dev:admin    # http://localhost:5174
```

Mặc định cả 2 app dùng **mock server** (`VITE_USE_MOCK=true` trong `apps/*/.env`).
Dữ liệu mock lưu trong localStorage; muốn khôi phục dữ liệu mẫu, gõ trong console trình duyệt:
`__hwnMock.reset()`. Nếu trình duyệt không cho đăng ký Service Worker (vd. mở qua `http://<IP LAN>` trên
điện thoại), mock tự chuyển sang chặn `fetch` ngay trong trang (`__hwnMock.mode === 'fetch-fallback'`).

Để dùng backend thật, tạo `apps/<app>/.env.local`:

```
VITE_USE_MOCK=false
API_PROXY_TARGET=http://localhost:8080
```

Vite sẽ proxy `/api` tới backend để tránh CORS. Bản build production (`.env.production`) luôn tắt mock.

## App người dùng trên điện thoại

Camera chỉ hoạt động trên HTTPS, nên để thử trên điện thoại thật:

```bash
npm run dev:user:lan
```

Mở địa chỉ `https://<IP máy tính>:5173` (Vite in ra dòng "Network") trên điện thoại cùng mạng Wi-Fi, chấp nhận
chứng chỉ tự ký. Mock tự chuyển sang chế độ chặn `fetch` vì Service Worker không chạy với chứng chỉ tự ký.

Các cách xác định vị trí: chụp ảnh (camera trực tiếp hoặc chọn ảnh), tự chạm lên bản đồ, bắt đầu từ cửa
chính, hoặc mã QR dán trong viện: `https://<app>/?b=<buildingId>&at=<floorId>,<x>,<y>`
(vd. `?b=bld_lan_main&at=bld_lan_main_t1,12.5,10`; `?b=` một mình chỉ chọn toà nhà). Mã cũ chỉ có `?at=` vẫn dùng
được — app tự tìm toà có tầng đó.
Bản build production là PWA (cài lên màn hình chính); icon sinh bằng `node scripts/gen-icons.mjs`.

Điểm đến có thể là **phòng** hoặc **mốc** (quầy thông tin, máy lấy số, ATM, nhà vệ sinh… — công cụ "Mốc", phím
`O` trong editor). Mỗi phòng có thể đặt **điểm đích đến** (bảng Phòng → "Đặt điểm đích", kéo chấm đỏ) để tuyến
kết thúc đúng chỗ thay vì giữa phòng. Bản đồ xoay theo la bàn điện thoại (nút kim la bàn trên bản đồ) dựa vào
**hướng Bắc** của toà nhà — đặt ở bảng "Toà nhà" trong editor (0° = Bắc hướng lên trên bản vẽ). Chế độ "Theo
bước chân" đếm bước bằng cảm biến gia tốc; la bàn và bước chân chỉ chạy trên điện thoại qua HTTPS.

## Lệnh

| Lệnh                | Việc                                  |
| ------------------- | ------------------------------------- |
| `npm test`          | Chạy unit + integration test (Vitest) |
| `npm run typecheck` | Kiểm tra kiểu toàn bộ workspace       |
| `npm run lint`      | ESLint                                |
| `npm run format`    | Prettier                              |
| `npm run build`     | Typecheck + build cả 2 app            |

## Editor bản đồ (app admin → "Vẽ toà nhà" / "Khuôn viên")

Mã nguồn: [apps/admin/src/editor](apps/admin/src/editor). Thao tác thuần (thêm/sửa/xoá, snap, hit test) nằm trong
`ops.ts` / `snap.ts` và có unit test; store zustand giữ bản nháp + lịch sử undo/redo.

| Phím                           | Việc                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `V` / `H`                      | Chọn / di chuyển bản đồ (hoặc giữ Space, chuột giữa)                          |
| `W`                            | Vẽ tường (Enter / Esc / click lại điểm cuối để dừng)                          |
| `D` / `N` / `E`                | Cửa đi / cửa sổ / cửa ra vào chính                                            |
| `L` / `S` / `K`                | Thang máy / thang bộ / thang cuốn                                             |
| `R` / `F`                      | Vẽ phòng theo đỉnh / click vào vùng kín để tạo phòng                          |
| `P` / `J`                      | Thêm điểm / nối cạnh đồ thị đi lại                                            |
| `M`                            | Hiệu chỉnh tỉ lệ ảnh nền                                                      |
| `I`                            | Thư viện ký hiệu: giường bệnh, ghế chờ, thiết bị y tế… (nhấn lại để đổi loại) |
| `Q` / `X`                      | Ghi kích thước (click 2 điểm + click đặt đường) / chú thích chữ               |
| `Ctrl+Z` / `Ctrl+Y`            | Hoàn tác / làm lại                                                            |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | Copy / dán (dán sang tầng khác giữ nguyên vị trí) / nhân bản                  |
| `Delete`, phím mũi tên         | Xoá / dịch đối tượng theo ô lưới (Shift = ×10)                                |
| `Ctrl+S`                       | Lưu (kiểm tra lỗi trước khi gửi)                                              |

**Ghi chú & lớp:** đường kích thước và chú thích chữ lưu trong `Floor.annotations` (chỉ editor vẽ, app người
dùng bỏ qua). Bảng **Lớp** (tab Thuộc tính, khi không chọn gì) ẩn hoặc khoá từng lớp: tường & cửa, phòng, thang,
mốc, kích thước & chữ — lớp khoá vẫn hiện và bắt dính được nhưng không chọn / sửa được.

**Nội thất & thiết bị:** công cụ `I` mở thư viện 17 ký hiệu ([furniture.ts](apps/admin/src/editor/furniture.ts)) —
giường bệnh, giường ICU, nôi, cáng, giường khám, ghế, dãy ghế chờ, bàn, quầy, tủ, ghế nha khoa, máy siêu âm, X-quang,
CT / MRI, cột truyền dịch, bồn rửa, bồn cầu. Đặt gần tường thì ký hiệu tự quay lưng vào tường và áp sát (Alt = đặt tự
do, Shift+R = xoay trước khi đặt); kích thước, góc xoay sửa ở bảng bên phải. Lưu trong `Floor.furniture`, có lớp riêng,
có trong bản xuất. App người dùng vẽ nội thất trên bản đồ 2D / 3D.

**Nội thất là vật cản khi chỉ đường:** "Tự sinh cho tầng này" coi nội thất (kèm khoảng hở 0,3 m) như tường, nên đường tâm
hành lang đi vòng và điểm đích tự sinh của phòng không rơi lên giường / bàn. Với đồ thị vẽ tay hoặc sinh trước khi kê đồ,
cạnh xuyên qua nội thất bị cộng thêm 100 m chi phí (`FURNITURE_PENALTY`) — tuyến ưu tiên lối khác nhưng vẫn đi được nếu
không còn lối nào — và tab Kiểm tra báo cảnh báo `NAV_THROUGH_FURNITURE` (bấm để chọn món nội thất đó).

**Căn chỉnh & chia đều:** chọn từ 2 đối tượng → bảng bên phải có 6 nút căn mép trái / giữa / phải / trên / giữa /
dưới theo hộp bao chung; từ 3 đối tượng có thêm **Chia đều ngang / dọc** (giữ hai đối tượng ngoài cùng, khoảng hở giữa
các đối tượng bằng nhau). Mỗi lần là một bước Hoàn tác; ô cửa đi theo tường nên không tính.

**Sửa trong 3D:** bật **Xem 3D** rồi dùng công cụ Chọn (`V`) ngay trong cảnh 3D — click để chọn tường, ô cửa, phòng,
thang, mốc, nội thất (Shift+click chọn thêm), kéo để dời trên mặt sàn (bám lưới, Hoàn tác như 2D); kéo chỗ trống để xoay
camera. Vùng chọn đồng bộ với khung 2D và bảng thuộc tính, viền cam hiện trong cả hai; Delete, Shift+R, phím mũi tên dùng
được như trong 2D ([edit3d.ts](apps/admin/src/editor/edit3d.ts), `Floor3DEditor` trong `@hwn/map-render/3d`). Nội thất
dựng thành khối theo chiều cao từng loại (giường 0,55 m, tủ 1,8 m, cột truyền dịch 1,9 m…).

**Xuất / nhập bản vẽ:** nút **Xuất** (trang Vẽ toà nhà) xuất tầng đang mở theo các lớp đang hiện — PNG
(50 px/m), SVG vector (tỉ lệ 1:100, mở đúng tỉ lệ trong Illustrator / Inkscape) hoặc In / PDF (khổ A3 vừa trang,
chọn "Lưu dưới dạng PDF" trong hộp thoại in); bản xuất có tiêu đề, thước tỉ lệ và hướng Bắc
([exportPlan.ts](apps/admin/src/editor/exportPlan.ts)). Bảng "Ảnh mặt bằng (nền)" nhận cả file **DXF**
([dxf.ts](apps/admin/src/editor/dxf.ts)): LINE, POLYLINE (kể cả cung), CIRCLE, ARC, TEXT / MTEXT, block (INSERT) và
DIMENSION được dựng thành nền vector đúng kích thước thật (đơn vị lấy từ `$INSUNITS`, không có thì đoán). DWG chưa
đọc được — lưu lại thành DXF trong AutoCAD.

**Nhiều toà nhà:** hai trang vẽ không có ô chọn toà — trang Vẽ toà nhà đổi toà bằng các tab tên toà; nút
**+ Thêm toà** (đầu trang) tạo toà mới trong cơ sở đang xem, bảng "Toà nhà" (tab Thuộc tính) đổi tên (lưu cùng nút
Lưu) và xoá toà. Các trang xem dữ liệu một toà (Tổng quan, Khoa phòng, Lưu lượng) vẫn chọn toà ở ô "Toà nhà" trên
thanh trên cùng (lựa chọn được nhớ lại). Mỗi toà là một bản đồ riêng với version riêng; ID tầng, phòng phải duy nhất trên toàn hệ thống. Ở app người
dùng, tên toà dưới tiêu đề là ô chọn toà, và ô tìm kiếm có thêm nhóm "Ở toà nhà khác" (chọn sẽ chuyển sang toà
đó). Chưa có chỉ đường liên toà. Dữ liệu mock chỉ có bệnh viện thật theo bộ bản vẽ LAN (cơ sở `campus_lan`, các toà `bld_lan_*`); cơ sở và hai toà mẫu (`bld_hwn_demo`, `bld_hwn_annex`) chỉ còn dùng trong test (`resetMockDb({ sample: true })`).

**Vẽ toà nhà và Khuôn viên — hai trang riêng**: mỗi cơ sở (`Campus`,
[campus.ts](packages/map-core/src/campus.ts)) gồm các toà đặt trên cùng một hệ toạ độ — `BuildingPlacement` = vị
trí gốc toạ độ của toà + góc xoay (độ, chiều kim đồng hồ). Hai trang dùng chung bản nháp:

- **Vẽ toà nhà** (`/map`, **mỗi lần vẽ một toà**): các công cụ tường, cửa, phòng, thang… Khung vẽ chỉ có toà
  đang mở (theo hệ trục của toà, không có toà khác hay phần ngoài trời; 3D cũng chỉ dựng toà này). Đổi toà bằng
  các tab tên toà ở đầu trang (dấu • = có thay đổi chưa lưu) — không phải lưu trước khi đổi, bản nháp và lịch sử
  Hoàn tác của mọi toà được giữ chung; toà mới mở ở cùng tầng chung.
- **Khuôn viên** (`/site`, sắp xếp vị trí): `V` chọn / kéo toà, đường, khu vực, cổng, điểm; Shift+click hoặc
  Shift+kéo khung để chọn nhiều (kể cả toà) rồi dời / xoay cả nhóm (R / Shift+R 15° quanh tâm nhóm, mũi tên 1 m,
  Alt = không bám lưới); bảng bên phải nhập toạ độ (tâm) và góc xoay. Nút **✎ Vẽ thêm** mở nhóm công cụ tạo mới
  (`P` đường / dốc / lối đi · `A` khu vực · `G` cổng · `O` điểm · `L` cầu nối) và cho sửa đỉnh. Ngoài ra: ảnh vệ
  tinh làm nền + hiệu chỉnh tỉ lệ, thông tin cơ sở (tên, địa chỉ, GPS, hướng Bắc). Double-click vào toà (hoặc nút
  "Vẽ trong toà này") mở trang Vẽ toà nhà ở toà đó.

Nút **Lưu** / `Ctrl+S` lưu mọi toà có thay đổi lẫn cơ sở (mỗi toà và cơ sở một tài liệu, `version` riêng); toà
nào còn lỗi kiểm tra thì không gửi gì và mở toà đó để xem lỗi. Hoàn tác / Làm lại theo trang đang mở. Thêm cơ sở
và chuyển toà giữa các cơ sở ở trang **Quản lý cơ sở** (`/campuses`, mở từ bảng "Cơ sở" ở trang Khuôn viên hoặc ô
"Toà nhà" ở các trang khác); đường dẫn cũ `/campuses/:id/site` tự mở trang Khuôn viên.

**Sảnh & dốc thuộc về toà (như "lô đất" trong SimCity / Cities: Skylines):** `Building.exterior`
([exterior.ts](packages/map-core/src/exterior.ts)) chứa sảnh, khu đón trả khách, làn đón, dốc lên sảnh, lối đi bộ… theo
hệ trục của toà, vẽ ở trang **Vẽ toà nhà → lớp "Sảnh & dốc"** (tầng trệt). Công cụ `S` **Sảnh đón dựng sẵn**: click vào
một cửa chính là có cả cụm sảnh + khu đón trả khách + làn đón một chiều + dốc lên / dốc xuống có lối đi bộ
(`lobbyExterior`, xe chạy bên phải). Ở **Khuôn viên** phần này được ghép vào mặt bằng (`campusSitePlan`) và đi theo
toà khi dời / xoay; chỉ cần vẽ đường nối vào các **đầu nối** của toà (`exteriorSockets` — chân dốc nối đường xe, chân
lối đi bộ nối vỉa hè / lối đi). Đầu nối chưa có đường tới hiện chấm cam kèm mũi tên; đường mới vẽ tự bắt dính vào
đầu nối và vào tim đường khác (tạo ngã ba); nút **Nối** / **Nối tất cả** thêm đoạn nối vào đường gần nhất
(`socketConnector`); kéo toà tới gần đường thì chân dốc tự hút vào làn xe (`magnetToRoad`, Alt để tắt). Bản đồ 2D / 3D
và chỉ đường liên toà đều dùng mặt bằng đã ghép; bản đồ một toà (không có khuôn viên) vẫn vẽ sảnh, dốc quanh tầng trệt.

**Dốc lên sảnh:** `SitePath` loại `ramp` vẽ theo tim làn xe, từ chân dốc lên sảnh (`rampCenterline` làm mượt
đường cong và bẻ đầu dốc cho tiếp tuyến với làn đón trả khách nối vào). Lớp vẽ được sắp để không lộ chỗ ghép: lòng
đường chính phủ lên chân dốc, dốc vắt qua vỉa hè (có vạch qua đường cho người đi bộ), vỉa hè phủ chân lối đi bộ
trên dốc, sân / sảnh phủ đỉnh lối đi bộ. `flow` (`up` / `down` / `both`) là chiều xe chạy — mũi tên trên dốc. `use`
cho biết dốc / làn phục vụ khu nào — `emergency` (Cấp cứu, đỏ), `outpatient` (Khoa Khám bệnh, xanh dương),
`inpatient`, `lobby`, `service` (màu viền, huy hiệu, nhãn). Dốc dùng chung cho xe và người: `walkway` (`left` /
`right` / `both`, theo chiều đi lên) thêm lối đi bộ lát gạch có bó vỉa, rộng `sidewalk` (mặc định 1.5 m); chỉ
đường đi bộ / xe lăn dùng lối này. Vạch qua đường tự kẻ ở mọi chỗ lối đi bộ hoặc vỉa hè cắt ngang dốc.

**Sân / sảnh** (khu vực loại `plaza`) là chỗ người đi bộ: vẽ thành mặt lát, và khi chỉ đường được đi thẳng giữa
các lối đi, đỉnh lối đi bộ trên dốc và cửa toà nằm trong sân (`buildSiteWalkGraph(..., areas)`).

**Mặt lát nối quanh sảnh** (`siteAprons` trong [aprons.ts](packages/map-core/src/aprons.ts)): khoảng hở nhỏ
(≤ 200 m²) bị kẹp giữa sân / sảnh và các lối đi bộ, vỉa hè, lối đi bộ trên dốc được tự lát kín để phần đi bộ liền
một mặt — không cần vẽ thêm. Chỉ lấp khoảng hở bị bao kín, nằm sát sân (không bị hàng rào / lòng đường ngăn) và
không lát lên lòng đường, lòng dốc, toà nhà hay các khu vực khác. Bản đồ 2D vẽ mặt lát này liền với sân, và chỉ
đường coi nó như sân (đi thẳng qua). Trên đường chung, người đi bộ được chỉ đi theo vỉa hè hai bên (qua đường ở
đầu đường, chỗ đường đổi hướng và chỗ lối đi bộ cắt ngang). Trong 3D, mặt lát nối nằm trên bệ cao bằng sảnh
(0.45 m), có bậc xuống ở mép giáp lối đi / vỉa hè.

**3D cả bệnh viện** (`Campus3D` trong `@hwn/map-render/3d`): mọi toà đặt đúng vị trí / góc xoay, các tầng
theo cao độ thật trên bệ sảnh cao 0.45 m, phần ngoài trời dựng khối (đường, bãi xe, dốc nghiêng từ mặt đường lên
sảnh kèm lối đi bộ, mái che, hàng rào, cổng, biển tên dốc theo khu). Tầng đang chọn là tầng "cắt": hiện nội thất,
các tầng trên vẽ mờ. Dùng ở chế độ 3D của bản đồ toà (nút "Cả bệnh viện" / "Chỉ toà này"), trang Bản đồ toàn
viện của app người dùng (nút 2D / 3D) và nút "Xem 3D" của editor admin.

**App người dùng thấy cả bệnh viện:** trang chủ có thẻ "Bản đồ toàn viện" (mọi toà kèm phòng + ngoài trời, chạm
vào toà để chuyển). Bản đồ chỉ đường / chọn vị trí của một toà (`MapViewer` với prop `campus`, xem `CampusContext`
trong map-render) vẽ thêm khuôn viên và các toà khác bên dưới, khung nhìn mặc định căn cả khuôn viên; ở màn "Chọn
trên bản đồ", chạm vào toà khác để chọn vị trí trong toà đó. Phần ngoài trời và chỉ đường liên toà: xem đoạn dưới.

**Khoa dùng chung toàn viện:** danh mục khoa nằm ở `/departments`; `Building.departments` server luôn trả về danh
mục này và bỏ qua giá trị client gửi lên khi lưu toà. Thêm / sửa / xoá khoa ở trang Khoa phòng được lưu ngay (không qua
bản nháp); chỉ xoá được khoa không còn phòng ở bất kỳ toà nào.

Các trang **Vẽ toà nhà**, **Khuôn viên** và **Khoa phòng** cùng sửa một bản nháp (nút Lưu trên thanh trên cùng, lưu một lần
cho tất cả). Đồ thị đi lại: vẽ tường + cửa + phòng rồi bấm "Tự sinh cho tầng này" (bảng Tầng), sau đó chỉnh
tay nếu cần.

Thang ở các tầng có cùng `linkId` là cùng một giếng thang — dùng nút "+ Tầng x" trong bảng thuộc tính
của thang, hoặc copy rồi dán sang tầng khác.

## Mô hình dữ liệu (tóm tắt)

Xem chi tiết trong [packages/map-core/src/types.ts](packages/map-core/src/types.ts).

- Đơn vị **mét**; mỗi tầng có trục riêng, `x` sang phải, `y` hướng xuống (như canvas). Khi dựng 3D: `x→X`, `y→Z`, `elevation→Y`.
- `Building` → `Floor[]` + `Department[]` + `version` (chống ghi đè khi nhiều người cùng sửa).
- `Floor` gồm `walls`, `openings` (cửa / cửa sổ / cửa ra vào, gắn vào tường bằng `wallId` + `offset`), `connectors` (thang máy / thang bộ / thang cuốn), `rooms` (đa giác + `departmentId`), `navGraph` (đồ thị đi lại).
- Thang ở các tầng khác nhau có cùng `linkId` thì nối thông với nhau.
- Phòng thuộc khoa qua `room.departmentId` (một nguồn dữ liệu duy nhất).
- Nút đồ thị loại `room` với `refId = room.id` là điểm đến khi chỉ đường tới phòng đó.
- `enclosedAreaAt(walls, p)` ([rooms.ts](packages/map-core/src/rooms.ts)): vùng kín do tường tạo ra quanh điểm `p`
  (đồ thị phẳng từ đường tâm tường, tách tại giao điểm / chỗ nối chữ T).
- `generateNavGraph(floor)` ([navgen.ts](packages/map-core/src/navgen.ts)): lưới hoá mặt bằng → vùng hành lang →
  làm mảnh (Zhang–Suen) lấy đường tâm → nối cửa vào phòng/thang/hành lang → dọn nhánh cụt.

## Hợp đồng API

Xem [packages/api-client/src/contract.ts](packages/api-client/src/contract.ts). Backend cần cài đặt đúng các endpoint này:

| Method + path                                              | Mô tả                                               |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `GET /buildings`                                           | Danh sách toà nhà                                   |
| `GET/PUT /buildings/:id`                                   | Lấy / lưu toàn bộ toà nhà (kèm `version`)           |
| `PUT /buildings/:id/floors/:floorId`                       | Lưu một tầng `{ version, floor }`                   |
| `GET/POST /buildings/:id/departments`                      | Danh sách / tạo khoa                                |
| `PUT/DELETE /buildings/:id/departments/:deptId`            | Sửa / xoá khoa (409 nếu còn phòng)                  |
| `GET /buildings/:id/rooms?q=&floorId=&departmentId=`       | Tìm phòng (không phân biệt dấu)                     |
| `POST /localize` (multipart: `image`, `buildingId?`)       | Định vị bằng ảnh → `LocalizeResult`                 |
| `POST /route` `{ buildingId, from, to, accessibleOnly? }`  | Chỉ đường → `Route`                                 |
| `GET /buildings/:id/traffic?floorId=`                      | Ảnh chụp lưu lượng                                  |
| `GET /buildings/:id/traffic/history?hours=&bucketMinutes=` | Lịch sử lưu lượng (mặc định 24 giờ, 15 phút/điểm)   |
| `WS /buildings/:id/traffic/stream`                         | Đẩy `{ type: 'snapshot', data }` định kỳ (realtime) |

Client lưu lượng (`createTrafficStream` trong api-client) ưu tiên WebSocket, tự kết nối lại, và tự chuyển sang
gọi REST định kỳ khi WebSocket không dùng được. Mock mô phỏng người đi lại theo tuyến thật, đông theo giờ
trong ngày (cao điểm ~9h và ~14h30).

Lỗi trả về dạng `{ code, message, details? }` với HTTP 4xx/5xx
(ví dụ `VERSION_CONFLICT` 409, `INVALID_MAP` 422 kèm danh sách lỗi kiểm tra, `NO_ROUTE` 422).

## Lộ trình

- [x] **Giai đoạn 0** – Khởi tạo monorepo, `map-core`, hợp đồng API, mock server, khung 2 app
- [x] **Giai đoạn 1** – `map-render`: hiển thị 2D (Konva) / 3D (three.js) dùng chung
- [x] **Giai đoạn 2** – Admin: editor bản đồ
- [x] **Giai đoạn 3** – Admin: khoa phòng & đồ thị đi lại
- [x] **Giai đoạn 4** – User: camera định vị + chỉ đường 2D/3D
- [x] **Giai đoạn 5** – Admin: lưu lượng realtime (WebSocket, heatmap)
- [ ] Giai đoạn 6 – Đăng nhập, PWA, test E2E, deploy
