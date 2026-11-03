# Water Network — chỉnh đỉnh và kéo đoạn có bảo toàn kết nối

Ngày: 2026-10-13. Trạng thái: thiết kế chi tiết đã được người dùng duyệt trong chat ngày 2026-10-13.

## 1. Mục tiêu và phạm vi

Người biên tập cần điều chỉnh tuyến ống nhanh bằng đỉnh và đoạn, tương tự tương tác draw.io, đồng thời giữ quan hệ kết nối thực của mạng. Đợt đầu gồm hiển thị/sửa đỉnh, kéo đoạn, bảo vệ đầu nối và tách ống chính xác. Thành công khi một lần kéo sinh một bước undo, đầu ống vẫn khớp nút tham chiếu, và thay đổi đi qua revision hiện có.

Nguồn yêu cầu: https://chatgpt.com/share/6ace5090-3328-83ec-9800-4d8b21ec3405 và phạm vi được người dùng duyệt trong chat. Quyết định nền: `water-network-be/docs/decisions/0020-published-network-edit-revisions.md`.

Đối tượng triển khai là `apps/gis/src/pages/gis/network-editor`, được lazy-load từ `gis-runtime-page.tsx`. Editor mô phỏng `screens/editor.tsx` và route editor cũ không phải đích triển khai. Workspace hiện có thay đổi chưa commit; khi triển khai phải giữ và tích hợp với trạng thái đó.

Không gồm auto-connect nhánh, merge, disconnect/reconnect mới, extend/trim, truy vết, vòng đời tài sản hay tự động định tuyến vuông góc. Các mục này thuộc đợt sau.

## 2. Hiện trạng đã kiểm tra

- Workspace có revision, quyền write/approve, save/validate/submit, undo/redo và backup theo tenant/revision.
- Chọn đối tượng chuyển hình học của nó sang layer draft để sửa; layer này cũng chứa các đối tượng đã thay đổi khác.
- Adapter Modify hiện sửa toàn source draft và phát callback riêng từng feature. Chưa có phạm vi sửa theo selection, transaction cho một gesture hay tay cầm kéo đoạn.
- Di chuyển Node đã cập nhật đầu các Pipe tham chiếu; sửa đầu Pipe chưa áp dụng chính sách tương ứng.
- `splitPipe` tìm đoạn gần điểm bấm nhưng dùng điểm đầu vào thay vì điểm chiếu. Adapter pick-point có chiếu, nhưng model vẫn cần tự bảo đảm invariant cho mọi lối gọi.
- Tách ống có Device host đã bị chặn để tránh gán thiết bị sai đoạn; giữ chặn này.

## 3. Cách tiếp cận

Chọn mở rộng adapter OpenLayers qua MapEnginePort, kết hợp các hàm geometry/topology thuần trong editor. Engine xử lý pointer, projection, hit-test và preview; editor xử lý Asset, refs, quyền và revision.

Chỉ thêm overlay vào Modify hiện tại ít thay đổi nhưng không giải quyết kéo đoạn và undo khi nhiều feature cùng thay đổi. Tạo một engine bản đồ khác tốn công và trùng hạ tầng. Mở rộng port giữ được kiến trúc hiện tại và kiểm thử bằng fake port.

## 4. Hành vi người dùng

### Chọn và sửa đỉnh

Chọn Pipe rồi bật Sửa đỉnh. Hiện đỉnh thật dạng vòng đặc, trung điểm dạng vòng mờ. Kéo đỉnh trong đổi vị trí; kéo trung điểm chèn một đỉnh mới. Alt+click đỉnh trong hoặc chọn đỉnh rồi bấm nút Xóa đỉnh thực hiện xóa. Luôn giữ ít nhất hai điểm; đầu tuyến có tham chiếu không được xóa. Selection và tool xác định duy nhất đối tượng sửa.

Delete khi đang chọn đỉnh chỉ xóa đỉnh, không xóa tài sản. Phím tắt không bắt sự kiện từ input, textarea hay contenteditable. Không có đỉnh chọn thì nút xóa đỉnh bị vô hiệu.

### Kéo đoạn

Chọn Pipe rồi bật Kéo đoạn. Mỗi trung điểm hiện tay cầm hình vuông để phân biệt với chèn đỉnh. Pointer-down lên tay cầm chọn đoạn; kéo dịch hai đỉnh của đoạn cùng một vector trong hệ tọa độ bản đồ phẳng. Preview chạy trong adapter, chưa ghi history hay backup.

Hai đầu ngoài của toàn tuyến giữ nguyên, kể cả khi không có ref. Nếu đoạn được kéo chạm đầu tuyến, chèn đoạn nối giữa đầu gốc và đầu đã dịch. Với tuyến hai điểm, kéo tạo tuyến bốn điểm: đầu gốc → đầu dịch → cuối dịch → cuối gốc. Đoạn giữa dịch hai đỉnh và giữ các đỉnh khác. Không tự tạo junction tại các điểm uốn hoặc giao cắt.

Snap dùng vị trí tay cầm đích làm neo, áp dụng cùng vector cho cả đoạn để giữ hình dạng. Bật/tắt theo snap hiện có. Không suy diễn snap thành kết nối thủy lực. Esc hoặc pointercancel hủy preview, khôi phục hình học gốc, không thêm history. Thả chuột commit đúng một thao tác. Kéo không đổi hình học không tạo thao tác.

### Đầu nối

Trong Sửa đỉnh, đầu Pipe có fromRef/toRef hợp lệ giữ cố định ở tọa độ Node tham chiếu. Muốn đổi vị trí nút chung, dùng thao tác sửa Node hiện có; tất cả đầu ống liên quan cập nhật một lần. Muốn đổi nút, dùng trường nối đầu/cuối hiện có.

Đầu không có ref được sửa tự do; không tự gán Node. Ref tồn tại nhưng không resolve thành Node hợp lệ thì chặn thao tác hình học trên Pipe và báo cần sửa kết nối. Không âm thầm bỏ ref. Giữ nguyên fromRef/toRef/hostRef khi sửa đỉnh hay kéo đoạn.

### Tách ống

Chiếu điểm bấm lên đoạn gần nhất trong EPSG:3857, sau đó đổi về EPSG:4326. Nếu gần đầu toàn tuyến trong 0,01 m thì từ chối. Nếu gần đỉnh trong trong 0,01 m thì dùng chính đỉnh đó; không nhân đôi đỉnh trong hai phần. Bỏ các điểm liên tiếp trùng trong dung sai này và từ chối nếu một phần có dưới hai điểm hoặc dài không quá 0,01 m.

Giữ ID của phần đầu theo cơ chế Update hiện có, phần sau và junction nhận ID mới. Hai phần kế thừa thuộc tính, phần đầu giữ fromRef, phần sau giữ toRef, hai đầu giữa cùng tham chiếu junction mới. Cả ba thay đổi cùng commit/undo. Không thêm schema lineage mới trong đợt này; before snapshot và operations vẫn là lịch sử hiện có.

## 5. Ranh giới kỹ thuật và luồng dữ liệu

Thêm API opt-in vào port, giữ `setModifyMode` và `onModifyComplete` cho consumer cũ:

- `setGeometryEditTarget(target | null)`: target gồm featureId, mode vertex/segment, lockedEndpointIndices; null hủy gesture và tháo interaction. Chỉ hoạt động trên feature trong draft.
- `onGeometryEditComplete(cb)`: phát một geometry EPSG:4326 cho một gesture hoàn tất.
- `onGeometryVertexSelect(cb)`: phát featureId và vertexIndex hoặc null để UI bật nút xóa.
- `deleteSelectedGeometryVertex()`: đi qua cùng validation và completion như gesture.

Các kiểu chỉ dùng dữ liệu/plain GeoJSON, không đưa kiểu ol qua port. Target mode mới không chạy cùng legacy Modify hoặc Draw. Overlay chỉ phục vụ hình học đang chọn, không tham gia hit-test selection, snap targets hay serialization tài sản. Adapter cleanup toàn bộ interaction/listener/preview khi destroy, đổi selection/tool hoặc bỏ quyền sửa.

Tách helper geometry trong `network-editor/geometry.ts`: xử lý projection qua utility dùng chung không phụ thuộc ol, chiếu lên đoạn, handles, dịch đoạn, chuẩn hóa và kiểm tra tuyến. Helper topology trong model tạo danh sách Edit mới từ State hiện hữu, không mutation dữ liệu đầu vào. Kiểm tra khóa đầu và ref tại model dù adapter đã khóa tay cầm.

Luồng: gesture → adapter preview → completion → editor kiểm tra quyền/revision/selection → helper geometry/topology → commit một danh sách Edit → undo/dirty/backup cập nhật → layer và handles vẽ lại. Nếu validation fail, báo lỗi và render lại hình học từ state trước thao tác.

Preview gắn với tenant, revision, selection và tool lúc bắt đầu. Khi bất kỳ giá trị nào thay đổi, hủy gesture; completion cũ không được ghi vào state mới. Khóa thao tác khi busy hoặc revision ngoài Draft/Validated.

Không thay API lưu revision, expectedVersion, kiểm tra phía server hay quy trình duyệt. Backend vẫn là nơi quyết định dữ liệu đủ điều kiện công bố. Chiều dài hiển thị tính theo mét mặt đất; EPSG:3857 dùng cho tương tác và phép chiếu tại khu vực Việt Nam, không dùng chiều dài phẳng đó thay cho chiều dài tài sản.

## 6. Files và quyết định

- `network-editor/geometry.ts` và tests: toán hình học.
- `network-editor/model.ts`, `model.test.ts`: sửa bảo toàn refs, tách tại điểm chiếu, thao tác nguyên tử.
- `network-editor/workspace.tsx`, `workspace.test.tsx`, `editor.css`: công cụ, quyền, selection, báo lỗi và history.
- `packages/map-runtime/src/port/*`, `testing/fake-port.ts`, `openlayers/ol-map-adapter.ts` và tests: target, handles, pointer gesture, cleanup; ưu tiên tách helper interaction để adapter không phình lớn.
- Thêm ADR trong FE ghi hợp đồng port opt-in và chính sách giữ đầu nối khi triển khai. Không thay interface API backend hay cấu trúc Asset.

## 7. Tiêu chí kiểm thử

1. Unit geometry: kéo đoạn đầu/giữa/cuối và tuyến hai điểm, delta bằng 0, tọa độ không hữu hạn, đoạn suy biến, split tại đỉnh và ngoài tuyến, EPSG:4326 ↔ EPSG:3857.
2. Unit topology: đầu có ref bất động, đầu không ref sửa được, ref thiếu bị chặn, di chuyển Node cập nhật nhiều Pipe bằng một commit, giữ refs/attributes/expectedVersion.
3. Adapter/fake-port: chỉ sửa selected feature; overlay không thành asset; completion một lần, cancel không completion; bỏ selection, đổi tool, destroy hủy gesture; legacy consumers vẫn hoạt động.
4. Workspace: một undo/redo phục hồi đầy đủ thao tác; lỗi không đổi edits; tenant/revision đổi loại completion cũ; Submitted/read-only không sửa được; save giữ payload revision hiện tại.
5. Browser: kéo đỉnh/thêm/xóa, kéo đoạn tuyến hai điểm và nhiều điểm, Esc, pan/zoom, snap on/off, giữ đầu nối và reopen draft sau save. Dùng dữ liệu thử, không ghi mạng vận hành.

Chạy tests liên quan của GIS và map-runtime, typecheck/build cả hai và regression editor cũ. Chỉ báo chức năng hoàn tất khi có kết quả kiểm thử và xác minh browser; lỗi nền ngoài phạm vi phải ghi rõ riêng.

## 8. Thứ tự triển khai dự kiến

Geometry helpers và split → bảo vệ refs/transaction model → port và interaction → UI workspace → tests tích hợp và browser. Viết implementation plan sau khi thiết kế này được duyệt. Không triển khai đợt P1/P2 từ tài liệu này.
