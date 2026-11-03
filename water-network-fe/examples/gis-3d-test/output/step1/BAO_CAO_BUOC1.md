# Bước 1 — Kiểm tra bản vẽ "2. MB Ong Dich vu - Vinh Thinh"

- Nguồn: file DWG AutoCAD 2018 (AC1032), đổi sang DXF bằng LibreDWG 0.13.3.
- Đơn vị: `$INSUNITS = 0` (không khai báo). Có thể là mét, vì nhãn "L=..m" khớp với chiều dài đo được (sai lệch khoảng 2%).
- Phạm vi tọa độ: X 549 400 – 552 490, Y 2 340 860 – 2 344 742. Khớp với VN-2000, kinh tuyến trục 105°, múi 3°, khu vực Vĩnh Tường.
- Không có cao độ: Z = 0 cho toàn bộ 8 411 điểm.
- Bản đồ nền địa chính (xref "Nen BDDC Vinh Thinh") không đi kèm file.

| Layer | Đối tượng | Chiều dài vẽ | Diễn giải (tạm hiểu, cần xác nhận) |
|---|---|---|---|
| 315 | 1 polyline | 1 816 m | Ống chính D315 (đi vào từ phía Bắc) |
| 225 | 3 polyline | 4 504 m | Ống chính D225 |
| 160 | 6 polyline | 2 032 m | Ống phân phối D160 |
| 110 | 4 polyline | 2 655 m | Ống phân phối D110 |
| 90 | 10 polyline | 3 921 m | Ống phân phối D90 |
| 63 | 210 polyline + 118 block | 12 821 m ống + 3 844 m đường ZIGZAG | Ống dịch vụ D63. 11 đường ZIGZAG có vẻ là ranh giới khu vực, không phải ống |
| 50 | 544 polyline/line + 1 255 block | 28 726 m | Ống dịch vụ D50 (nhãn ghi tổng 29 371 m) |
| Text D-L | 1 125 chữ + 582 đường dẫn | — | Nhãn "D50, L=61m" (tổng nhãn: D50 29 371 m, D63 11 659 m) |
| Text an | 136 chữ | — | Nhãn D90/110/160/225/315 trên ống chính |
| Text phu kien | 733 chữ | — | B = bịt, T = tê, C50 = cút, C63/50 = côn |
| ten dai khoi thuy | 180 block Daudai + 186 nhãn kt1…KT186 | — | Đai khởi thủy (điểm nối ống dịch vụ vào ống chính) |
| DEFPOINTS | 28 khung + số 1–28 | — | Khung tờ bản vẽ |

**Kiểm tra nhanh:**
- 180/180 đai khởi thủy nằm trên ống chính (cách tối đa 0,32 m).
- 179/180 đai khởi thủy chạm ống dịch vụ.
- 395/400 block "bit" nằm trên ống dịch vụ.
- Ống dịch vụ có 405 đầu tự do, gần bằng số nút bịt — hợp lý.
- 18/48 đầu ống chính không chạm ống chính khác. Sẽ phân tích ở Bước 2.

**Bản vẽ không có:** van, trụ cứu hỏa, đồng hồ khách hàng, trạm bơm/bể/nguồn nước, cao độ, vật liệu, năm lắp đặt.
