# SHW — Biên tập mạng đã xuất bản

Trạng thái: thiết kế để rà soát, chưa triển khai. Ngày: 2026-09-24.

## Vấn đề đã xác minh

Route canonical-rich #editor hiện trỏ vào ImportScreen. Hồ sơ CAD đã submitted bị khóa nên màn này không thể sửa mạng GIS đã xuất bản. EditorScreen cũ có công cụ vẽ nhưng commit chỉ thay đổi G.changeSets và branch-store trong trình duyệt, với người dùng/mã hồ sơ giả lập. Không được đưa luồng này vào vận hành như một API lưu thành công.

GIS hiện có đăng ký/xóa ống, nút, thiết bị và di chuyển nút. Chưa có cập nhật ống và phiên sửa mạng có phê duyệt. Design có bản nháp thêm tài sản, cập nhật geometry nháp, validate/submit/approve; chưa biểu diễn update/delete tài sản GIS hiện có. Đây là thay đổi hợp đồng backend, không chỉ đổi route.

## Hành vi người dùng

- Import CAD: giữ vai trò nạp, phân loại và kiểm tra bản vẽ. Không hiển thị thẻ file CAD ở màn biên tập mạng.
- Biên tập mạng: tải dữ liệu GIS thật của đơn vị, dùng EPSG:4326, mặc định nền OSM. Không dùng phép đổi tọa độ pixel của editor demo.
- Người có network-design:write tạo/mở bản thay đổi; người chỉ có quyền đọc xem bản đồ và lịch sử.
- Chọn ống/nút/thiết bị trên bản đồ để xem thuộc tính, chọn sửa hoặc đánh dấu xóa. Có tìm theo mã và phóng tới đối tượng.
- Công cụ vẽ ống, thêm nút/thiết bị, kéo đỉnh, chèn/xóa đỉnh; bắt điểm để nối với nút hiện có. Vẽ cắt qua tuyến không mặc nhiên tạo đấu nối. Tách tuyến phải tạo nút và cập nhật quan hệ rõ ràng.
- Bảng bên phải hiển thị tài sản đang chọn và danh sách Thêm/Sửa/Xóa, số lượng và màu phân biệt. Có hoàn tác/làm lại và bỏ một thay đổi.
- Lưu nháp lên máy chủ và mở lại đúng dữ liệu sau tải lại. Không dùng localStorage thay cho lưu máy chủ.
- Luồng đề xuất: Nháp → Kiểm tra → Gửi duyệt → Duyệt hoặc trả lại → Xuất bản. Trước xuất bản, mạng chính thức không đổi. Phương án lưu trực tiếp chỉ triển khai nếu người dùng chọn rõ và có quyền GIS write phù hợp.
- Người duyệt có network-design:approve trong đúng tenant; ghi lý do và căn cứ. Không tự cấp quyền, không tự duyệt dữ liệu SHW để kiểm thử.
- Sau xuất bản, hiển thị kết quả từng thao tác và tải lại bản đồ. Trạng thái đang xử lý/lỗi một phần không hiển thị như thành công toàn bộ.

## Hợp đồng dữ liệu và tính toàn vẹn

Mỗi thay đổi mang operation (add/update/delete), asset kind, stable target ID, expected target version, hình học/thuộc tính/quan hệ sau sửa và ảnh chụp trước sửa do máy chủ đọc. Máy chủ xác định tenant/actor từ phiên đăng nhập. Không cho client chọn tenant hoặc khai người duyệt.

Bản thay đổi có ID, version CAS, trạng thái, title/reason, creator/reviewer và audit timestamps. Lưu/submit/approve kiểm tra version, quyền và trạng thái. Sau gửi duyệt khóa nội dung. Nếu tài sản gốc đổi trong lúc chờ duyệt, báo xung đột và yêu cầu rà soát lại; không ghi đè.

Mở rộng Design revision để chứa thao tác trên GIS hiện có; không tạo một hệ phê duyệt song song trong worker import. Hợp đồng sự kiện mới phải tương thích consumer cũ và có khóa idempotency theo revision/operation. GIS giữ quyền sở hữu tài sản và kiểm tra toàn bộ trước áp dụng, dùng transaction/outbox và cơ chế đối soát/retry. Không cập nhật trực tiếp PostgreSQL từ frontend/worker.

Xóa là soft-delete có audit. Không xóa nút còn ống sử dụng hoặc ống còn thiết bị gắn nếu chưa có phương án xử lý trong bản thay đổi. Di chuyển nút phải xử lý các đầu ống liên quan trong cùng tập thay đổi. Thiết bị phải gắn đúng loại host và đúng tenant. Sửa ống giữ ID để bảo toàn liên kết tài sản. Kiểm tra tọa độ hữu hạn, đường kính/vật liệu, chiều dài, mã trùng và quan hệ topology.

## Phạm vi kiểm thử và triển khai

Unit: thao tác draft, undo/redo, conversion tọa độ, phiên bản và lifecycle. Contract/integration: tenant isolation, quyền đọc/ghi/duyệt, add/update/delete, FK/host, rollback, idempotent retry, race giữa hai editor, publish kết quả. UI: chọn/vẽ/sửa/xóa có xem trước, lưu mở lại, trạng thái khóa và thông báo lỗi thực tế.

Chạy tích hợp trên tenant/fixture thử nghiệm; không thay đổi tài sản vận hành SHW để thử. Triển khai backend/migration/event compatibility trước, frontend sau; smoke-test SHW chỉ đọc khi chưa có dữ liệu thử được chỉ định. Ghi image digest và kế hoạch rollback. Không bật editor chỉ bằng cách bỏ điều kiện route khi backend còn thiếu.
