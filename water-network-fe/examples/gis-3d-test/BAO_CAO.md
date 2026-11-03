# Báo cáo: Mô hình GIS – thủy lực mạng cấp nước Vĩnh Thịnh

*Bản vẽ gốc: "2. MB Ống Dịch vụ – Vĩnh Thịnh" (DWG AutoCAD 2018). Ngày lập: 27/10/2026.*

> **Đọc trước:** bản vẽ chỉ cho **hình học và đường kính ống**. Số hộ, nhu cầu, trạm bơm, van, rò rỉ, cao độ đều là **giả định** (mục 2) hoặc lấy từ dữ liệu công khai. Kết quả mục 4–6 dùng để **so sánh tương đối giữa các kịch bản** và chỉ ra điểm yếu cấu trúc mạng, chưa phản ánh đúng số tuyệt đối của vận hành thực tế. Cần hiệu chỉnh bằng số liệu đo trước khi ra quyết định đầu tư.

## 1. Kết quả kiểm tra bản vẽ (Bước 1–4)

| Hạng mục | Kết quả |
|---|---|
| Định dạng | DWG AC1032, đổi sang DXF bằng LibreDWG 0.13.3 |
| Đơn vị | Không khai báo (`$INSUNITS = 0`). Có thể là **mét**: chiều dài vẽ khớp nhãn "L=…m" (D50 vẽ 28 726 m, nhãn ghi 29 371 m) |
| Hệ tọa độ | VN-2000, KTT 105°00′, múi 3°. Phạm vi X 549 400–552 490, Y 2 340 860–2 344 742 |
| Kiểm tra với OSM | Ống chính cách tim đường OSM: trung vị **2,1 m**, P90 6,1 m; 98,2% trong phạm vi 10 m. Dò dịch chuyển hệ thống ±30 m cho kết quả tốt nhất ở (0, 0), tức không có sai lệch hệ thống. Ảnh chồng lớp: `output/step3/overlay_osm.png` |
| Cao độ | Bản vẽ không có Z (Z = 0 cho toàn bộ 8 411 điểm). Lấy từ DEM Copernicus GLO-30: mặt đất **12,0–19,7 m** (TB 16,4 m, EGM2008) |
| Layer ống | 50, 63 = ống dịch vụ HDPE (mới); 90/110/160/225/315 = ống phân phối/truyền dẫn |
| Layer khác | `Text D-L` (nhãn D, L), `Text an` (nhãn ống chính), `Text phu kien` (B = bịt, T = tê, C = cút/côn), `ten dai khoi thuy` (180 đai KT1…KT186), `DEFPOINTS` (28 khung tờ), đường ZIGZAG trên layer 63 = ranh giới (loại bỏ) |
| Không có trong bản vẽ | Van, trụ cứu hỏa, đồng hồ khách hàng, trạm bơm/bể, vật liệu, năm lắp đặt, bản đồ nền địa chính (xref không kèm theo) |

**Mạng lưới sau khi dựng topology:**
- 1 012 nút, 1 012 ống, tổng **56,5 km**: D315 1,8 km; D225 4,5 km; D160 2,0 km; D110 2,7 km; D90 3,9 km; D63 12,8 km; D50 28,7 km.
- Toàn mạng liền một khối nhưng **chỉ có 1 vòng**, gần như dạng cây.
- 180/180 đai khởi thủy trùng nút nối; 397 đầu ống có block bịt.

**Lỗi số hóa** (đầy đủ trong `output/step2/loi_so_hoa.csv` và lớp "Lỗi số hóa" trên web):

| Mã | Mức | Nội dung | Xử lý |
|---|---|---|---|
| E001, E002 | đỏ | 2 đầu ống D225 hở (phía Tây và phía Đông, ra ngoài phạm vi bản vẽ) | Giả định đóng. Cần xác nhận có nối mạng lân cận không |
| E008, E009 | đỏ | 2 đầu ống D90 hở, không có bịt | Coi là ống cụt |
| E013 | đỏ | Đầu D90 cách ống D50 2,37 m nhưng không nối | Để nguyên, cần kiểm tra |
| E022, E023 | đỏ | 2 điểm D50 cắt D50 không có nút | Để nguyên (coi là đi chéo) |
| E020, E021 | vàng | Khe hở 1,01 m và 0,53 m làm 2 nhánh (106 m và 22 m ống) bị cô lập | **Đã tự nối** (giả định) |
| E014–E019, E015 | vàng | 5 đầu ống dịch vụ hở không có bịt; 1 nút treo D50–D90 cách 2,27 m | Để nguyên |
| E003–E012 (8 lỗi) | info | Ống chính vẽ thừa 1–2,6 m qua điểm đấu nối cuối | Không ảnh hưởng thủy lực |
| 16 nhãn | vàng | Nhãn ghi D50 nhưng ống ở layer 63 (hoặc ngược lại) | Dùng đường kính theo layer |
| 81 nhãn | info | Tổng nhãn L lệch chiều dài vẽ > 15% | Tham khảo |

<a id="gia-dinh"></a>
## 2. Bảng giả định

| # | Giả định | Giá trị | Lý do |
|---|---|---|---|
| 1 | Hệ tọa độ | VN-2000, KTT 105°00′, múi 3°, k = 0,9999; towgs84 = −191,90441, −39,30318, −111,45032, −0,00928836, 0,01975479, −0,00427372, 0,252906278 | KTT của Vĩnh Phúc (cũ) theo hiểu biết, chưa đối chiếu văn bản; tham số towgs84 theo TT 973/2001/TT-TCĐC. Đã kiểm chứng với OSM (lệch 2 m) |
| 2 | Vật liệu, đường kính trong | HDPE PE100 PN10 (SDR17); ID = OD − 2e (D50 → 44 mm … D315 → 277,6 mm) | Bản vẽ ghi OD, không ghi vật liệu |
| 3 | Hệ số Hazen-Williams | Ống dịch vụ 140; ống chính 130 | HDPE mới; ống chính đã vận hành |
| 4 | Năm lắp đặt | Ống dịch vụ 2025; ống chính 2012 | Chưa có hồ sơ (chỉ dùng để tô "tuổi ống") |
| 5 | Gộp nút / tự nối | Gộp < 0,5 m; tự nối khe ≤ 2 m nếu khe làm cô lập mạng con (2 trường hợp) | Theo yêu cầu; tránh mất nhánh |
| 6 | Cao độ | Phân vị 10% các pixel DSM trong bán kính 45 m quanh nút, bỏ pixel mặt nước < 11 m | DSM gồm cả nhà và cây; tránh lấy nhầm mặt sông |
| 7 | Nguồn | Trạm bơm tại đầu D315 phía Bắc (giáp đê tả sông Hồng); mực bể = mặt đất + 2 m | Ống lớn nhất đi vào từ phía Bắc |
| 8 | Bơm | 2 bơm song song, mỗi bơm 14,4 L/s tại 32 m (đường đặc tính 1 điểm: H₀ = 42,7 m); hiệu suất 75% | Thiết kế theo nhu cầu giờ cao điểm + rò rỉ |
| 9 | 2 đầu D225 | Đóng, không có lưu lượng chuyển tiếp sang khu khác | Chưa rõ hiện trạng |
| 10 | Số hộ | 1 hộ / 15 m ống dịch vụ → **2 770 hộ**; 4 người/hộ → 11 079 người | Nhà hai bên ngõ, mặt tiền 6–8 m, lấp đầy khoảng 50%. **Cần thay bằng số đấu nối thật** |
| 11 | Định mức | 100 L/người/ngày + 10% công cộng → 14,1 L/s trung bình | QCVN 01:2021/BXD khu dân cư nông thôn |
| 12 | Phân bổ nhu cầu | Theo chiều dài ống dịch vụ, chia đều 2 đầu ống. Ống chính không có đấu nối trực tiếp | Khách hàng nối qua đai khởi thủy và ống dịch vụ |
| 13 | Đồ thị 24 h | 0,45 0,40 0,38 0,40 0,55 0,95 1,45 1,55 1,30 1,10 1,05 1,15 1,25 1,05 0,90 0,85 0,95 1,30 1,65 1,75 1,45 1,10 0,80 0,55 (chuẩn hóa, Kh max = 1,73 lúc 19 h) | Dạng điển hình nông thôn VN: cao điểm sáng và tối |
| 14 | Rò rỉ nền | Emitter tại nút, tỉ lệ chiều dài ống, N = 1,0; hiệu chỉnh để **NRW ≈ 18%** | Mạng mới ở nông thôn VN thường 15–25% |
| 15 | Van | **233 van**: đầu 183 nhánh dịch vụ, mọi nhánh của tê ống chính, sau trạm bơm | Bản vẽ không có van |
| 16 | Ngưỡng | Áp lực < 10 m / > 60 m; vận tốc > 1,5 / < 0,1 m/s; tổn thất > 5 m/km (ống chính), > 15 m/km (ống dịch vụ) | TCVN 33:2006 và theo yêu cầu |
| 17 | Chữa cháy | 10 L/s trong 2 h (17–19 h) tại J0725, trụ giả định trên D225 (nút ống chính có áp lực giờ cao điểm thấp nhất) | TCVN 2622, khu dân cư nhỏ |
| 18 | Thử rò rỉ ẩn | 2 L/s. "Số đo" tổng hợp = mô hình + nhiễu nhu cầu (chung ±5% × từng nút ±15%) + nhiễu logger σ = 0,05 m; 10 logger áp lực | Chưa có số liệu đo |
| 19 | DMA | Đặt đồng hồ trên ống chính khi số hộ phía sau ≥ 450 | Cỡ DMA phổ biến 500–1 000 đấu nối |
| 20 | Mạch vòng đề xuất | Chiều dài = 1,15 × khoảng cách thẳng; ≥ D110 | Ước lượng tuyến theo đường |

## 3. Mô hình thủy lực (Bước 5)

- File EPANET: `output/vinh_thinh.inp` (EPANET 2.2, LPS, H-W, tọa độ VN-2000). Đã nạp lại và chạy độc lập bằng WNTR thành công.
- Chạy **72 h** để tuổi nước ổn định, bước thủy lực 1 h; kết quả lấy chu kỳ 24 h cuối.
- **Hội tụ:** có, không có cảnh báo EPANET.
- **Cân bằng khối:** sai số lớn nhất giữa nước bơm vào và tổng nhu cầu + rò rỉ là 0,00002 L/s.
- **Áp lực:** 26,6–44,9 m, tức hợp lý cho nhà 1–3 tầng.
- **Vận tốc lớn nhất:** 0,47 m/s, ống chính dư công suất so với nhu cầu giả định.
- **Nước bơm vào:** trung bình 16,9 L/s, cao điểm 26,9 L/s; **1 482 m³/ngày**.

## 4. Kết quả kịch bản (Bước 8–9)

| Kịch bản | % nút đạt ≥ 10 m | % nhu cầu được cấp | Hộ bị ảnh hưởng | kWh/m³ | NRW % | Tuổi nước TB (h) | Áp lực min (m) |
|---|---|---|---|---|---|---|---|
| **Hiện trạng** | 100 | 100 | 0 | 0,137 | 17,8 | 5,5 | 26,6 |
| Giờ cao điểm 19 h | 100 | — | 0 | — | rò rỉ 2,55 L/s | — | 26,6 (trung vị 30,5) |
| Giờ thấp điểm 2 h | 100 | — | 0 | — | rò rỉ 3,37 L/s | — | 37,1 (max 44,9) |
| Vỡ ống trục P0001 (D315) | 12,0 | 11,5 | **2 452** | 0,155 | 20,7 | 4,9 | 39,8 |
| Vỡ ống nhánh P0071 (D160) | 91,1 | 88,8 | **316** | 0,141 | 18,5 | 5,8 | 29,2 |
| Dừng 1 bơm | 45,6 | 99,7 | **1 475** | 0,093 | 13,4 | 5,9 | **6,1** |
| Bơm suy giảm 15% tốc độ | 100 | 100 | 0 | 0,096 | 13,0 | 5,8 | 15,5 |
| Chữa cháy 10 L/s tại J0725 | 100 | 100 | 0 | 0,133 | 16,7 | 5,2 | 17,0 (tại trụ 17,2) |
| Tăng nhu cầu 25% | 100 | 100 | 0 | 0,129 | 14,0 | 4,7 | 21,2 |
| Rò rỉ ẩn 2 L/s | 100 | 100 | 0 | 0,134 | **26,1** | 5,3 | 25,1 |
| *(đề xuất)* Giảm áp đêm bằng biến tần | 100 | 100 | 0 | 0,130 | 16,3 | 5,6 | 21,4 |

**Nhận xét từng kịch bản:**
- **Vỡ ống:**
  - Vỡ P0001 (D315 ngay sau trạm): đóng 2 van, **2 452 hộ (89%) mất nước**. Mạng dạng cây nên toàn bộ phía sau mất nước theo.
  - Vỡ P0071 (D160): đóng 20 van, đoạn cô lập 745 m, 316 hộ mất nước.
  - Danh sách van cần đóng hiển thị trên web (biểu tượng ⊠).
- **Dừng 1 bơm:** vẫn cấp được 99,7% lượng nước. Nhưng giờ cao điểm áp lực tụt xuống 6,1 m, **1 475 hộ dưới 10 m**. Chỉ số kWh/m³ và NRW giảm vì áp lực thấp hơn, đây không phải dấu hiệu tốt.
- **Bơm suy giảm 15%:** còn đạt chuẩn (áp lực min 15,5 m) nhưng dư địa an toàn nhỏ.
- **Chữa cháy 10 L/s:** đạt; áp lực tại trụ 17,2 m.
- **Tăng nhu cầu 25%:** đạt; áp lực min 21,2 m, không ống nào quá 0,57 m/s.
- **Rò rỉ ẩn:** đánh giá qua 40 lần thử ngẫu nhiên:
  - phát hiện được **100%**: lưu lượng đêm tăng khoảng 1,9 L/s, vượt ngưỡng 3σ = 0,73 L/s;
  - khoanh đúng DMA **100%**;
  - sai số vị trí với 10 logger áp lực: **trung vị 372 m**, P75 634 m; 33% trường hợp trong phạm vi 250 m.

  Nguyên nhân sai số lớn: ống chính lớn nên rò rỉ 2 L/s chỉ làm áp lực tụt vài cm. Ngoài hiện trường cần nghe dò hoặc dùng correlator trong DMA đã khoanh. Lần thử hiển thị trên web: rò rỉ thật tại J0251, ước tính tại J0221, **sai số 127 m**.

## 5. Điểm có vấn đề (Bước 7)

Có 55 cảnh báo, xem tab "Vấn đề" trên web hoặc file `output/geojson/diem_van_de.geojson`:

| Loại | Số | Mức | Ghi chú |
|---|---|---|---|
| Áp lực < 10 m / > 60 m | 0 / 0 | — | Ở hiện trạng giả định. Áp lực thấp xuất hiện khi dừng 1 bơm |
| Vận tốc > 1,5 m/s | 0 | — | |
| Tổn thất cột áp bất thường | 0 | — | Giờ cao điểm lớn nhất 1,80 m/km trên ống chính (P0213, D90) và 3,49 m/km trên ống dịch vụ (P0365, D63), dưới ngưỡng 5/15 m/km. Phát hiện tắc hoặc van đóng thật cần so với áp lực đo |
| Một tuyến cấp (> 300 hộ phía sau) | 14 | 9 đỏ | Trục D315 P0010 → P0001 → … cấp cho 2 770 → 844 hộ |
| Nước tù: ống chính v < 0,1 m/s cả ngày | 15 tuyến (4,1 km) | vàng | Thêm 40,4 km ống dịch vụ v < 0,1 m/s, điều bình thường với ống nhánh cụt |
| Ống chính cụt | 13 | vàng | 2 đầu D225, 1 D160, 4 D110, 6 D90 |
| Tuổi nước > 24 h ở đầu cụt | 13 | vàng | 7 nút ≥ 72 h, tức bằng thời lượng mô phỏng: nước gần như không lưu chuyển |

**Phương pháp:**
- Áp lực và vận tốc: so ngưỡng trên toàn 24 h mô phỏng.
- Tổn thất bất thường: độ dốc thủy lực giờ cao điểm.
- Một tuyến cấp: cạnh cầu (bridge) của đồ thị mạng.
- Tuổi nước: mô phỏng AGE trong EPANET.
- Rò rỉ: lưu lượng đêm nhỏ nhất (MNF) → cân bằng DMA → bình phương tối thiểu trên ma trận độ nhạy áp lực (1 012 ứng viên × 10 logger).

## 6. Đề xuất cải tạo (theo ưu tiên)

| Ưu tiên | Đề xuất | Căn cứ |
|---|---|---|
| **1** | **Khép 3 mạch vòng** D110: J0172–J0178 (~42 m), J0205–J0246 (~155 m), J0151–J0290 (~801 m) | Số hộ mất nước kỳ vọng khi hỏng ngẫu nhiên 1 ống chính giảm **508 → 336 hộ** |
| **1** | **Nguồn cấp thứ hai**: khảo sát 2 đầu D225 (J0204, J1012) để đấu nối liên vùng, có van và đồng hồ | Toàn bộ 2 770 hộ phụ thuộc 1 trạm và 1 tuyến D315 |
| 2 | **Kiểm kê và lắp van cô lập** tại 233 vị trí giả định | Bản vẽ không có van. Với bố trí này, đoạn cô lập lớn nhất 97 hộ; thêm van không giảm thêm vì mất nước chủ yếu do cấu trúc dạng cây |
| 2 | **Biến tần cho bơm**: chạy 80% tốc độ từ 23 h đến 5 h. **Chưa cần van giảm áp (PRV)** vì áp lực max 44,9 m < 60 m | NRW 17,8% → 16,3%; điện năng 203 → 190 kWh/ngày; vẫn 100% nút đạt áp lực |
| 2 | **Chia 5 DMA** dạng bậc thang: DMA1 687 hộ (đồng hồ tổng), DMA2 539 hộ (P0037), DMA3 620 hộ (P0020), DMA4 453 hộ (P0059), DMA5 471 hộ (P0006); kèm 10 logger áp lực | Phát hiện rò rỉ 2 L/s 100%, khoanh đúng DMA 100% |
| 3 | **Van xả cặn** tại 13 đầu ống chính cụt; xả định kỳ 13 đầu nhánh có tuổi nước > 24 h | 4,1 km ống chính nước tù |
| 3 | **Chưa cần thay ống** theo tiêu chí thủy lực, kể cả khi nhu cầu tăng 25% | Cần hồ sơ năm lắp đặt, vật liệu thật và lịch sử sự cố để xếp hạng thay ống |
| — | **Sửa bản vẽ**: xử lý các lỗi đỏ E001/E002/E008/E009/E013/E022/E023, xác nhận 2 chỗ tự nối E020/E021, thống nhất 16 nhãn D lệch layer | Mục 1 |

## 7. Việc cần làm để mô hình phản ánh thực tế

1. Số đấu nối theo từng đai khởi thủy hoặc ngõ (thay giả định 1 hộ/15 m), cùng sản lượng hóa đơn theo tháng.
2. Thông số trạm bơm: đường đặc tính Q–H, cao trình bể, chế độ chạy; đồng hồ tổng theo giờ.
3. Vị trí và trạng thái van, trụ cứu hỏa; vật liệu và năm lắp đặt ống chính.
4. 1–2 tuần đo áp lực (5–10 logger) và lưu lượng đêm để hiệu chỉnh hệ số C và rò rỉ.
5. Xác nhận 2 đầu D225 có nối ra ngoài không; nếu có thì đó là điều kiện biên quan trọng nhất.

## Sản phẩm bàn giao

| Sản phẩm | Đường dẫn |
|---|---|
| Phần mềm GIS web | `web/` (README.md) |
| Script Python DXF → GeoJSON → .inp | `scripts/`, `run_all.sh` |
| GeoJSON WGS84 | `output/geojson/nut.geojson`, `ong.geojson`, `loi_so_hoa.geojson`, `diem_van_de.geojson`; `data/network/*.geojson` |
| Mô hình EPANET | `output/vinh_thinh.inp` |
| Kết quả trung gian | `output/step1…step5/`, `output/analysis/*.json`, `output/screenshots/` |
