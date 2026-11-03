# GIS mô phỏng mạng lưới cấp nước — Vĩnh Thịnh (Vĩnh Tường, Vĩnh Phúc cũ)

Đầu vào là bản vẽ AutoCAD *"2. MB Ống Dịch vụ – Vĩnh Thịnh"*. Pipeline Python chuyển bản vẽ thành mạng lưới GIS và chạy mô hình thủy lực EPANET. Ứng dụng web (React + MapLibre + deck.gl) hiển thị kết quả để đánh giá vận hành.

> ⚠️ Kết quả thủy lực dựa trên **các giả định** vì chưa có số liệu đo, số hộ, bơm, van… Xem bảng giả định trong [BAO_CAO.md](BAO_CAO.md#gia-dinh).

## Cấu trúc

```
data/raw/            bản vẽ gốc (.dwg) và bản DXF đã chuyển đổi
data/interim/        nút/ống/lỗi theo tọa độ VN-2000 (kết quả Bước 2)
data/network/        nút/ống/lỗi theo WGS84, đã có cao độ (Bước 3–4)
data/model/          vinh_thinh.inp (EPANET 2.2, đơn vị LPS, tọa độ VN-2000)
scripts/             pipeline Python
  config.py          tham số + mọi giả định (đánh dấu [GĐ])
  01_inspect_dxf.py  Bước 1: liệt kê layer/đối tượng/phạm vi
  01b_preview.py     ảnh xem trước bản vẽ
  02_build_network.py  Bước 2: topology, gộp nút 0,5 m, lỗi số hóa
  03_to_wgs84.py     Bước 3: VN-2000 → WGS84, kiểm tra với OSM
  04_elevation.py    Bước 4: cao độ từ DEM Copernicus 30 m
  model.py           dựng mô hình WNTR (nhu cầu, bơm, rò rỉ)
  05_hydraulic_model.py  Bước 5: hiệu chỉnh rò rỉ, xuất .inp, kiểm tra hội tụ/cân bằng
  06_analysis.py     Bước 7–9: điểm có vấn đề, kịch bản, chỉ số, đề xuất
  07_export_web.py   xuất JSON cho web + GeoJSON bàn giao
output/              kết quả từng bước (ảnh, CSV, JSON), GeoJSON, .inp, ảnh chụp web
web/                 ứng dụng GIS (Vite + React + MapLibre GL + deck.gl)
BAO_CAO.md           báo cáo ngắn
```

## Cài đặt

**Python ≥ 3.11**
```bash
pip install -r requirements.txt
```
Chỉ cần đổi lại từ DWG khi có bản vẽ mới. Việc này dùng [LibreDWG](https://github.com/LibreDWG/libredwg) (`dwg2dxf`), hoặc trong AutoCAD dùng `SAVEAS → DXF 2013/2018` rồi đặt file thành `data/raw/vinh_thinh.dxf`.

**Node.js ≥ 20**
```bash
cd web && npm install
```

## Chạy

```bash
./run_all.sh              # toàn bộ pipeline (≈ 6 phút; tự tải DEM nếu chưa có)
cd web && npm run dev     # mở http://localhost:5173
# hoặc bản build tĩnh:
npm run build && npm run preview   # http://localhost:4173
```
Thư mục `web/dist` sau khi build là trang tĩnh. Có thể đưa lên bất kỳ máy chủ web nào: Nginx, GitHub Pages…

Thư mục `web/public/data` đã có sẵn kết quả, nên có thể mở web ngay mà không cần chạy lại Python.

## Xem trên mạng (GitHub Pages)

Repo có sẵn workflow `.github/workflows/pages.yml`. Bật **Settings → Pages → Source: GitHub Actions** một lần; sau đó mỗi lần đẩy lên `main`, web tự build và có địa chỉ dạng `https://<tài-khoản>.github.io/<tên-repo>/`.
GitHub Pages cho repo **riêng tư** cần gói GitHub trả phí; với gói miễn phí, repo phải để công khai.

## Mở thẳng chế độ 3D dòng chảy

Thêm tham số sau dấu `#` vào địa chỉ web, ví dụ:

```
http://localhost:5173/#3d&metric=flow&hour=7&play&panels=0&view=105.4904,21.1852,16.6
```

| Tham số | Ý nghĩa |
|---|---|
| `3d` | nghiêng 60°, xoay −25° |
| `metric=` | `pressure`, `flow`, `velocity`, `pipeAge`, `waterAge`, `diameter`, `dma` |
| `scen=` | `base`, `vo_ong_1`, `vo_ong_2`, `bom_dung`, `bom_suy_giam`, `chua_chay`, `tang_nhu_cau`, `bien_tan_dem`, `ro_ri_an` |
| `hour=` | giờ bắt đầu 0–23 |
| `play` | tự chạy thanh thời gian |
| `columns` | bật cột áp lực 3D |
| `view=lon,lat,zoom` | vị trí và mức zoom ban đầu |
| `panels=0` | ẩn các bảng bên để xem toàn màn hình |

Video mẫu: `output/screenshots/3d_dong_chay.mp4`.

## Dùng phần mềm GIS

| Chức năng | Cách dùng |
|---|---|
| 2D / 3D | Nút **3D** góc phải dưới: nghiêng 60° và xoay. Kéo chuột phải để xoay hoặc nghiêng. La bàn và nút +/− nằm ngay bên dưới |
| Tìm kiếm | Gõ mã nút `J0251`, mã ống `P0071`, đai khởi thủy `KT12`, cảnh báo `I005`, lỗi `E013`, `DMA3`. Nhấn **Enter** để tìm tên đường hoặc địa danh (OSM Nominatim) |
| Tô màu ống | Áp lực / lưu lượng / vận tốc / tuổi ống / tuổi nước / đường kính / khu DMA |
| Hạt dòng chảy | Chạy theo chiều và tốc độ dòng tại giờ đang xem (tốc độ hiển thị tỉ lệ với vận tốc thật) |
| Cột áp lực 3D | Bật ở mục "Lớp hiển thị"; chiều cao = áp lực × 1,5 tại các nút có hộ dùng nước |
| Thanh thời gian | Kéo để chọn giờ 0–23, nút ▶ để phát tự động |
| Kịch bản | Hộp chọn bên trái, hoặc bấm vào một dòng trong bảng "So sánh kịch bản" |
| Chi tiết | Bấm vào ống hoặc nút để xem thuộc tính và biểu đồ 24 h (so với hiện trạng) |
| Cảnh báo | Ghim đỏ/vàng = điểm có vấn đề (Bước 7). Vòng đỏ = nút áp lực < 10 m tại giờ đang xem |
| Bảng điều khiển | Tab **Chỉ số** (KPI + so sánh kịch bản), **Vấn đề**, **Đề xuất** (bấm để bay tới vị trí) |

Bản đồ nền: OpenFreeMap (dữ liệu © OpenStreetMap), có lớp nhà 3D. Dữ liệu nhà ở khu vực nông thôn trên OSM còn thưa.

## Cập nhật khi có số liệu thật

1. Sửa các tham số `[GĐ]` trong `scripts/config.py`: số hộ/m ống, L/người/ngày, cột áp bơm, NRW…
2. Nếu có số đấu nối theo đai khởi thủy, thay hàm `allocate_households` trong `scripts/model.py`.
3. Nếu có bản vẽ van, thay tập `VALVES` trong `scripts/06_analysis.py`.
4. Chạy lại `./run_all.sh`.
