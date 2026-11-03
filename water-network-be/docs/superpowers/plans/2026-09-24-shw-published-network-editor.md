# Kế hoạch triển khai editor mạng SHW

Trạng thái: người dùng đã đồng ý luồng lưu nháp → gửi duyệt → cập nhật mạng chính thức; đã triển khai DEV và kiểm tra thực tế.
Spec: ../specs/2026-09-24-shw-published-network-editor.md

- [x] Xác minh route #editor hiện trỏ vào màn import CAD.
- [x] Xác minh editor cũ lưu giả lập, không có API commit thật.
- [x] Xác minh API GIS và Design hiện chưa bao phủ update/delete qua phê duyệt.
- [x] Viết đặc tả UX, quyền, dữ liệu, xung đột, kiểm thử và triển khai.
- [x] Rà soát/chốt luồng bản nháp qua duyệt hoặc ghi trực tiếp với người dùng.
- [x] Viết decision record mở rộng Design revision và hợp đồng sự kiện sửa mạng, bao gồm rollback và tương thích CAD import.
- [x] Viết test lỗi trước cho vòng đời draft và thao tác add/update/delete, đối tượng gốc, expected version và tenant.
- [x] Mở rộng draft DTO/domain/store/migration, API tạo/lưu/xóa thao tác và trả nội dung trước/sau.
- [x] Bổ sung validation quan hệ ống/nút/thiết bị và xung đột tài sản; không cho submit/publish dữ liệu không hợp lệ.
- [x] Mở rộng sự kiện publish và GIS consumer, cập nhật aggregate giữ ID, soft-delete, audit/outbox và kết quả từng thao tác.
- [x] Kiểm thử transaction/idempotency/race với PostgreSQL; kiểm tra quyền tại mọi API mutation.
- [x] Tạo workspace biên tập canonical với dữ liệu GIS thật, bản đồ EPSG:4326 và nền không yêu cầu CARTO key.
- [x] Nối chọn/vẽ/modify/snap vào draft operations; thuộc tính/quan hệ, undo/redo, danh sách thêm/sửa/xóa.
- [x] Nối lưu nháp/mở lại/validate/submit và duyệt/trả lại/đối soát kết quả bằng API thật.
- [x] Tách route editor khỏi ImportScreen; giữ CAD import và map-drafts hoạt động độc lập.
- [x] Chạy unit/contract/integration/UI, kiểm tra không mất dữ liệu khi reload và không báo thành công giả.
- [x] Chuẩn bị release/migration/rollback, triển khai DEV và xác minh; không tự sửa/xóa tài sản SHW để test.

Các đường dẫn chính:
- FE: apps/gis/src/pages/gis/gis-runtime-page.tsx, screens/editor.tsx, editor/ol-canvas.tsx.
- Map port: packages/map-runtime/src/port/map-engine-port.ts.
- BE: WaterNetwork.Design draft/revision API + domain + publish consumer; WaterNetwork.Gis domain repositories + import consumer.

Tiêu chí hoàn tất: một thao tác sửa thực tế và một thao tác thêm/xóa trên fixture có thể lưu, reload, gửi duyệt, duyệt và đối soát, với kết quả canonical đúng; mutation trái quyền/tenant và phiên bản cũ bị chặn. Chỉ khi đó mới thay màn editor SHW đang chạy.

Kết quả: rollout GIS 2/2, Design 1/1, BFF 2/2, SHW FE 2/2 và APISIX 1/1. Hai migration xác minh trong EF history cùng quyền runtime. API editor assets/revisions trả 200 với phiên SHW; không đăng nhập trả 401. Browser đã xác minh chọn tài sản, zoom đúng vị trí, nền OSM, import độc lập và mạng chính thức 631 ống/917 nút. Không tạo bản nháp hay sửa tài sản SHW để smoke; vòng đời ghi/duyệt/cập nhật kiểm tra trên fixture PostgreSQL riêng. Evidence: outputs/shw-network-editor-2026-09-24/.
