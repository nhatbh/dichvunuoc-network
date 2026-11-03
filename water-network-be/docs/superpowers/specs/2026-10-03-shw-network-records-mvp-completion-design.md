# SHW — Hoàn thiện MVP quản lý bản đồ và hồ sơ mạng

**Ngày:** 2026-10-03  
**Trạng thái:** Approved — người dùng duyệt tài liệu trong hội thoại ngày 2026-10-03. Implementation plans cũng đã được duyệt trong hội thoại, chọn inline execution: `../plans/2026-10-03-shw-network-records-mvp-completion.md`.
**Đối tượng:** cán bộ quản lý bản đồ/hồ sơ mạng SHW; người duyệt thay đổi mạng.  
**Chiến lược:** phục vụ SHW trước, sau đó chuẩn hóa và nhân rộng; không hard-code SHW vào core hoặc hạ chuẩn cách ly tenant.

## 1. Ý định và kết quả

MVP giúp SHW tra cứu dữ liệu mạng chính thức, biên tập một tập thay đổi có kiểm soát và xuất bản sau phê duyệt. Thành công được đo bằng hành trình nghiệp vụ có bằng chứng, không bằng số service hoặc số màn hình.

Ba hành trình bắt buộc:

1. Mở bản đồ → tìm mã tài sản → định vị → xem hình học, thuộc tính và hồ sơ.
2. Tạo/mở bản thay đổi → thêm/sửa/xóa → kiểm tra quan hệ → lưu nháp → tải lại và mở đúng nội dung đã lưu.
3. Kiểm tra → gửi duyệt → duyệt/trả lại → xuất bản → đối soát từng thao tác → xem mạng chính thức và lịch sử.

Dữ liệu nhập CAD chỉ bổ sung vào staging/Design. Upload hoặc preview thành công không chứng minh dữ liệu đủ tin cậy để xuất bản.

## 2. Nguồn và mức độ tin cậy của baseline

Tham chiếu:

- `../plans/2026-09-24-shw-published-network-editor.md`.
- `2026-09-24-shw-published-network-editor.md`.
- `../../../../../docs/superpowers/plans/2026-08-16-water-network-gis-canonical-completion.md`.
- `../plans/2026-06-13-master-implementation-roadmap.md`.
- `../../decisions/0020-published-network-edit-revisions.md`.

Quan sát read-only trong phiên 2026-10-03:

| Quan sát | Ý nghĩa / giới hạn |
|---|---|
| Commit `ed5d409e` có mở rộng Design/GIS và proxy editor | Có source baseline, không chứng minh release đang chạy đúng commit |
| Plan editor 2026-09-24 tick toàn bộ và ghi evidence deploy | Là bằng chứng lịch sử cần đối chiếu; không thay thế test/smoke mới |
| FE có WIP `apps/gis/src/pages/gis/network-editor/` và các thay đổi route/import | Giữ nguyên; kiểm chứng và review trước khi kết luận hoàn tất |
| `network-editor/api.ts` dùng `/api/gis/editor`, expected revision version và publish-result | Có integration surface; chưa kiểm chứng toàn bộ failure paths |
| BFF có fixed routes và permission cho đọc/ghi/duyệt | Không được thay bằng caller-supplied upstream hoặc permission |
| `screens/assets.tsx` còn `rows().slice(0, 200)` | Có giới hạn hiển thị cần xử lý; chưa kết luận mọi data path đều bị giới hạn |
| Có model tests và một workspace test cho vẽ/lưu/lỗi | Test tồn tại; chưa chạy lại trong phiên viết spec |

Không dùng số tài sản hay test count trong tài liệu cũ làm kết quả hiện tại. Không làm lại tính năng chỉ vì checkbox cũ chưa tick; không công nhận hoàn tất chỉ vì checkbox đã tick.

## 3. Phạm vi

### Trong MVP

- Baseline source/release có thể tái tạo; xác minh SDK/dependency/CI, auth và route SHW liên quan.
- Bản đồ canonical, search toàn tenant, danh sách phân trang và asset inspector.
- Hồ sơ hiện có từ GIS/Asset: định danh, hình học, thuộc tính kỹ thuật, vòng đời và nguồn dữ liệu.
- Biên tập Node/Pipe/Device, thuộc tính do GIS sở hữu và quan hệ from/to/host.
- Modify geometry, split pipe và connect node-to-pipe có quy tắc rõ.
- Undo/redo trên thay đổi chưa gửi; lưu/mở lại nháp server-side.
- Validation, submit/approve/reject, publish receipt, lỗi một phần và reconciliation.
- Lịch sử thay đổi mạng và audit người/thời điểm/lý do.
- CAD import hiện có hoạt động độc lập với editor, đi qua validation/Design.
- Backup/restore, migration compatibility, rollback và nghiệm thu fixture.

### Ngoài MVP

- Telemetry/Observation, vận hành DMA, trace/isolation cho điều hành, Incident/FSM.
- Hydraulic, Customer Impact, thông báo khách hàng, reporting nền và offline/mobile.
- Tự động sửa dữ liệu nguồn chưa xác minh hoặc tự động duyệt dữ liệu SHW.
- Hệ quản lý tài liệu đính kèm mới hoặc mở rộng vòng đời Asset nếu chưa có nhu cầu được duyệt.
- Refactor toàn platform, gateway mới hoặc scaffold service không phục vụ ba hành trình.

Validation quan hệ mạng vẫn trong phạm vi dù màn điều hành topology nằm ngoài MVP.

## 4. Kiến trúc và ownership

Giữ các bounded context hiện có:

- GIS sở hữu geometry và các quan hệ mạng; giữ stable asset ID khi sửa.
- Asset sở hữu lifecycle/technical profile; editor Design không được ghi hộ các fact này.
- Design sở hữu revision, draft operations, validation, approval và publish intent.
- Import worker sở hữu ingestion/review/provenance CAD, không tạo cơ chế phê duyệt song song.
- BFF là lớp proxy/read composition không database nghiệp vụ; FE chỉ gọi public BFF qua APISIX.
- APISIX là gateway hiện hành; spec này không thêm YARP.

Luồng ghi: FE → BFF → Design revision → event/outbox → GIS áp dụng → completion/receipt → Design → FE refetch.

Published network chỉ đổi khi thao tác đã được duyệt và GIS chấp nhận áp dụng. Approval không đồng nghĩa mọi thao tác đã được xuất bản. Không thêm event version mới nếu contract hiện có đáp ứng; mọi thay đổi breaking phải có ADR và contract compatibility tests.

## 5. Hành trình đọc

- Tenant lấy từ verified Organization/session context. Không cho body/query chọn tenant thay cho phiên.
- Map tải theo viewport, có chỉ báo loading/empty/error/truncation; response cũ không ghi đè viewport mới.
- Search thực hiện phía server trên toàn tenant, không lọc riêng các feature đã tải; tìm theo mã, loại và filter được backend hỗ trợ.
- Chọn kết quả ngoài viewport phải định vị đúng tài sản và tải vùng tương ứng.
- Asset list dùng cursor ổn định, không dùng 200 bản ghi làm trần dữ liệu. Không yêu cầu tải full tenant trước khi tìm kiếm.
- Inspector đọc GIS authoritative và compose hồ sơ Asset. GIS không tồn tại → not found; Asset unavailable → vẫn xem GIS với phần hồ sơ và source status rõ.
- Counts phân biệt tenant total với số đã tải. Lifecycle không được diễn giải thành trạng thái vật lý của van/bơm.
- Lịch sử cho biết thao tác, actor, thời điểm, lý do, revision và hình học trước/sau khi có capability; type chưa có history phải báo rõ, không tạo lịch sử giả.

## 6. Chất lượng dữ liệu SHW

- Canonical geometry dùng EPSG:4326; CRS nguồn được chọn/xác nhận tại biên import.
- Kiểm tra mã trùng, tọa độ hữu hạn/phạm vi, geometry hợp lệ, thuộc tính bắt buộc và references.
- Geometry giao nhau không tự sinh đấu nối. Thiếu material hoặc metadata không được tự điền thành fact đã xác minh.
- Giữ source/job/document/review provenance hiện có; không biến trường suy đoán thành trường đã xác nhận.
- Mỗi vấn đề chất lượng có code, asset/operation liên quan, mức error/warning và hành động khắc phục.
- Error chặn submit/publish. Warning được hiển thị cho người lập và người duyệt, lưu cùng căn cứ quyết định. Danh mục mandatory fields theo kind phải nằm trong contract/validator và test, không chỉ FE.
- Cán bộ SHW xác nhận vị trí và dữ liệu nguồn. Hệ thống không tuyên bố độ chính xác khảo sát từ việc bản đồ render đúng.

## 7. Biên tập và kiểm soát đồng thời

- Mỗi operation có ID, kind, Add/Update/Delete, target stable ID, expected target version và after payload; before snapshot lấy từ server.
- Revision có version CAS. Save kiểm tra version; hai editor không ghi đè âm thầm.
- Sau mutation thành công, response/refetch server là source of truth. Khi lỗi save, nội dung chưa lưu còn trên màn hình và được đánh dấu chưa lưu.
- Reload chỉ bảo đảm khôi phục dữ liệu đã lưu server; phải cảnh báo trước khi rời màn hình có thay đổi chưa lưu. Không hứa local undo history sống qua reload.
- Undo/redo chỉ áp dụng nội dung có quyền sửa, không thay đổi revision đã khóa hoặc đảo ngược published network trực tiếp.
- Di chuyển node phải xử lý đầu ống liên quan trong tập thay đổi; split/connect phải giữ geometry và references nhất quán.
- Không xóa node đang được pipe dùng hoặc pipe có device nếu chưa xử lý quan hệ trong tập thay đổi. Không đổi host device sang sai kind/tenant.
- Split pipe có thiết bị phải chuyển host có chủ ý hoặc bị chặn với hướng dẫn; không tự gán thiết bị sang đoạn tùy ý.
- Asset đã đổi sau lúc lập nháp phải được kiểm tra lại trước áp dụng. Conflict trả machine-readable error và yêu cầu rà soát; không silent overwrite.

## 8. Phê duyệt, xuất bản và phục hồi

- Phân quyền đọc/ghi/duyệt enforced server-side. UI chỉ giúp giải thích và disable action, không là security boundary.
- Người gửi không tự duyệt revision của mình trong MVP; người duyệt có capability đúng tenant. Kiểm chứng chính sách này với account fixture, không tự cấp quyền SHW.
- Submit khóa nội dung. Reject ghi lý do và trả về trạng thái cho phép sửa theo lifecycle hiện có. Mọi mutation làm validation cũ mất hiệu lực.
- Validation phải dùng cùng semantics ở save/validate/publish; trạng thái nguồn thay đổi sau validate vẫn được kiểm tra tại GIS.
- UI hiển thị trạng thái thực từ backend: đang xử lý, toàn bộ thành công, lỗi một phần, bị trả lại hoặc conflict; không suy ra Published chỉ từ approve HTTP 2xx.
- Kết quả có operation/draft ID, GIS ID khi thành công và reason khi thất bại. FE refetch mạng chính thức sau kết quả.
- Retry không tạo duplicate; thao tác đã thành công không bị áp dụng lại. Rà soát/sửa thao tác thất bại phải giữ lịch sử attempt và tuân thủ phê duyệt, không sửa revision đã khóa ngoài lifecycle.
- Mỗi transaction áp dụng giữ invariant cục bộ và receipt/outbox atomic; không hứa distributed transaction toàn revision. Partial result được biểu diễn minh bạch.
- Completion event thất lạc có đường reconciliation có quyền và audit. Recovery không yêu cầu sửa DB thủ công.

## 9. An toàn tenant, session và vận hành

- Cross-tenant asset/revision/reference trả 404; thiếu quyền trong tenant trả 403; chưa đăng nhập trả 401.
- Session đổi Organization/user phải hủy request cũ và clear data/editor scope; không gửi draft cũ sang tenant mới.
- Tenant, actor không nhận từ payload không tin cậy. Forward bearer/context theo verified platform contract, correlation và trace xuyên BFF/downstream.
- Production thiếu storage/downstream config phải fail rõ, không fallback sang mock hoặc báo lưu thành công.
- Không lưu token/credential trong evidence; không thay đổi account/quyền hoặc deploy production khi chưa được phép.
- Cấu hình SHW như home extent, import CRS preset, capability và danh mục tách khỏi core. Không xây generic abstraction trước khi có nhu cầu thực.

## 10. Nghiệm thu và bằng chứng

| Gate | Bằng chứng bắt buộc |
|---|---|
| Baseline | Commit/WIP inventory, SDK pin, từng test project có count > 0, release/image mapping; không trộn thay đổi ngoài scope |
| Tra cứu | Asset ngoài viewport vẫn search/fly-to được; list vượt 200; kiểm tra cursor boundaries; stale response không repaint |
| Khả năng tăng trưởng | Fixture đọc ít nhất 10.000 assets; đo response bytes, latency và browser memory; chứng minh không tải full tenant để search/map; lưu số đo, không tự nhận SLO chưa đo |
| Hồ sơ | GIS + Asset bình thường, Asset absent/down, asset deleted, history unsupported và tenant B đều có hành vi đúng |
| Nháp | Add/update/delete Node/Pipe/Device; save/reload; undo/redo; save failure giữ nội dung chưa lưu; session change an toàn |
| Quan hệ | Move node, split/connect, device host, delete dependencies, mã trùng và geometry sai có tests |
| Đồng thời | Hai editor sửa revision/asset cùng base; một request bị conflict, không mất thay đổi âm thầm |
| Phê duyệt | Creator không tự approve; thiếu permission/khác tenant bị chặn; sửa làm validation cũ mất hiệu lực |
| Publish | Deliver-twice, rollback transaction, dependency failure, partial result, retry và completion mất có test/fixture |
| CAD regression | Import route độc lập; sai CRS chưa confirm không ghi mạng; reload/retry không duplicate |
| Phục hồi | Restore trên DB/bucket fixture kiểm tra metadata và file thật; migration/previous image compatibility được ghi; không down-migrate trong incident |
| Nghiệm thu SHW | Cán bộ xác nhận tra cứu read-only mạng SHW; hành trình ghi/duyệt trên tenant fixture riêng được chỉ định |

Chạy .NET tests theo từng `.csproj`; exit 0 nhưng discover 0 là fail. FE chạy unit/UI, typecheck, lint với budget không tăng, production build/size và browser journeys. Không coi mock-only UI test là bằng chứng tích hợp backend.

Bằng chứng mỗi slice ghi trong chính implementation plan: command, count/result, commit hoặc WIP scope, fixture, image digest khi deploy và artifact path. Kết quả lịch sử không thay thế verification mới.

## 11. Release và quản lý trạng thái

- Trạng thái riêng: source present → verified → merged → deployed → smoke passed → accepted. Checkbox phải nói rõ gate nào đã đạt.
- Audit trước, chỉ lập task cho gap thực tế. Nếu code đã có, task là verify/fix gap, không tái triển khai.
- Backward-compatible backend/migration/event trước, FE sau. Giữ CAD import và dữ liệu hiện có.
- Nếu còn legacy rollback, chứng minh switch và route order thực sự hoạt động; không retire legacy chỉ vì canonical build xanh.
- Rollback release là config/image tương thích. Với mạng đã publish, sửa bằng revision bù trừ được duyệt, không rollback DB hoặc khôi phục backup đè dữ liệu vận hành.
- Backup/restore drill trên fixture; không deploy, merge/push, đổi quyền hoặc mutate SHW mà không có approval phù hợp.

## 12. Thứ tự triển khai sau khi spec được duyệt

1. Audit baseline editor/import/read, chốt matrix hiện có/chưa verify/thiếu; giữ nguyên WIP.
2. Chốt release/toolchain/security gates liên quan và khả năng phục hồi.
3. Hoàn thiện chất lượng dữ liệu, tra cứu và hồ sơ.
4. Đóng gap biên tập/quan hệ/lưu mở lại/concurrency.
5. Đóng gap phê duyệt/publish/partial recovery và regression CAD.
6. Nghiệm thu với cán bộ SHW, ghi giới hạn rõ; sau đó mới đề xuất chuẩn hóa nhân rộng.

Implementation plan được viết sau khi người dùng duyệt tài liệu này, dựa trên audit code và test. Không gộp OBS/HYD/CIM hay refactor toàn platform vào plan MVP.
