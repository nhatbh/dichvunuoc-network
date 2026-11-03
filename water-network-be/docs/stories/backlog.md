# Story Backlog

Spec intake: `docs/spec-init-01.md` (SPEC v1.0). Slice-level plans and ordering
live in `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` —
this table only tracks epic status.

Do not create every possible story packet up front. Create story packets when
the work is selected or when a product decision needs a durable place to land.

## Candidate Epics

| Epic | Description | Status |
| --- | --- | --- |
| Phase 0 — Foundation | Building blocks + gis-be RegisterNode slice (US-P0-01..04, US-P1-01) | done |
| Phase 1 — GIS + Asset Core | gis-be pipe/device/remove/bbox, asset-be lifecycle, GIS status projection, BFF overview (US-P1-02..07) | done (GIS-1..5, AST-1, AST-2, BFF-1) |
| Phase 2 — Design + Import | design-be project/document/draft/approve, publish→GIS qua event (US-P2-01..06) | done (DSN-1, DSN-2, DSN-3, DSN-4 done) |
| Phase 3 — Topology + Incident | topology-rs graph/gRPC, incident-be lifecycle + isolation plan (US-P3-01..05) | done (TOP-1..3 done, INC-1 done, INC-2 done, INC-3 done) |
| Phase 4 — Maintenance | ⚠️ MOVED → khối `water-fsm` (FSM xuyên miền) — decision 0025. water-network = producer (đã xong). | moved |
| Phase 5 — Zone + Observation | ZON-1 done trên PR #13 (chưa merge/deploy); observation-be ingest/latest/threshold (US-P5-01..04) | in progress — OBS-1 next |
| Phase 6 — Hydraulic | hydraulic-be model/scenario/EPANET export/result (US-P6-01..04) | unsliced |
| Phase 7 — Customer Impact + Reporting | customer-impact-be + reporting tối giản (US-P7-01..03) | unsliced |
| Cross-cutting | Event catalog registry, permission enforcement, YARP gateway, Keycloak thật, CI matrix (US-X-01..03) | gắn vào slice — xem roadmap §15 |

Lưu ý: trạng thái release ZON-1 vẫn mở cho tới khi PR #13 được merge, deploy và smoke-test; `done` ở đây là build/test xanh theo playbook.

## Follow-up sau GIS-2 InstallDevice

- ~~**Mapper registry**~~ — DONE (GIS-2 Task 5): `GisIntegrationEventMapper` đã refactor sang registry `Dictionary<string, Func<…>>`; xem `docs/conventions/template-mapping.md` §7.3.
- ~~**Versioning prefix toàn platform**~~ — DONE: chốt bằng decision `0009-api-route-prefix.md` (route `/api/network/...`, versioning thuộc YARP gateway US-X).
- **`dotnet test <slnx>` footgun**: SDK 10.0.107 silently chạy 0 test khi truyền `.slnx`. CI script phải chạy từng `.csproj` test project riêng (cân nhắc thêm script wrapper hoặc guard trong CI matrix).
- **`FindPostgresException` trùng lặp**: helper bắt unique-violation (SqlState 23505) → `ConflictException` hiện copy ở cả `RegisterNodeCommandHandler` lẫn `InstallDeviceCommandHandler`. Cân nhắc trích ra `PostgresExceptionHelper` chung trong Application layer khi handler thứ 3 cần (GIS-3+).
- ~~**`RegisterPipeCommandHandler` thiếu backstop unique-violation**~~ — DONE (GIS-3 Task 8): pipe handler nay bắt `DbUpdateException`/23505 → `ConflictException` (409), nhất quán với node/device.
- ~~**Partial index cho host refs**~~ — DONE (tech-debt cleanup, commit `9f59dfe`): `ix_network_devices_host_pipe`/`ix_network_devices_host_node` nay có filter `WHERE host_*_id IS NOT NULL` (EF `HasFilter` + migration `AddDeviceHostRefPartialIndexes`) → hết bloat từ các row `(tenant_id, NULL)`.
- ~~**Update-path test cho device/pipe repo**~~ — DONE (GIS-3 Task 8): nhánh `else` (mutation) của `PersistAsync` đã có test round-trip: save → soft-delete → save lần 2 → assert `DeletedAt` set + version tăng.

## Follow-up sau GIS-3 Remove/Relocate/GeometryVersion

- **Tenant check trên endpoint/host refs**: handler không kiểm tra xem node/pipe/device được tham chiếu có cùng tenant không (mirror GIS-1/2). Defer đến cross-cutting US-X-01 hoặc slice đầu tiên cần cross-tenant guard. Mutation-on-load guard RESOLVED in US-X-01 (decision 0016); endpoint/host *reference* guard still deferred.
- ~~**`FindPostgresException` trùng lặp**~~ — DONE (tech-debt cleanup, commit `1edb08e`): trích `WaterNetwork.Gis.Application.Common.PostgresExceptionHelper.IsUniqueViolation(Exception?)`; cả 4 handler (Register node/pipe, InstallDevice, Relocate) route qua helper, hết bản copy + `using Npgsql` thừa. (Khi `asset-be` xuất hiện và cần lại pattern này → cân nhắc promote helper lên building block.)
- **Geometry version cho pipe/device**: `GeometryVersionStore` + migration M4 đã có; GIS-3 chỉ append cho node (Register + Relocate). Pipe/device geometry version defer đến khi có reroute/relocate tương ứng (không có ở GIS-3 vì chưa có `ReroutePipe`).
- ~~**Relocate 23505 race**~~: ĐÃ XỬ LÝ trong GIS-3 — `RelocateNodeCommandHandler` nay bắt 23505 → `ConflictException` (mirror Register handlers).
- ~~**⚠️ HIGH — Outbox → bus mapper không khớp concrete type**~~ (PRE-EXISTING, toàn service): **ĐÃ SỬA Ở GỐC** (branch `fix/outbox-concrete-event-deserialization`, commit `b231000`). Hai sub-bug: (1) `OutboxRepository` serialize bằng compile-time type `IDomainEvent` → mất `Data`; nay serialize theo runtime type. (2) `OutboxProcessor` luôn dựng generic `OutboxDomainEvent` → typed mapper `e is NodeDeleted` luôn trượt; nay có `IDomainEventTypeResolver` (đăng ký per-service qua `AddOutboxDomainEventTypesFromAssembly`) để deserialize `Payload` về concrete type (giữ nguyên `EventId`/`OccurredAt` nhờ init-setter). Có integration test end-to-end outbox→publish (GIS) + unit test resolver. Fallback an toàn cho service chưa đăng ký (generic carrier → catch-all).
- **Outbox: service khác phải đăng ký event types**: bất kỳ service nào có typed `IIntegrationEventMapper` (vd `asset-be` khi có) PHẢI gọi `AddOutboxDomainEventTypesFromAssembly(...)` trong `Program.cs`, nếu không mapper vẫn nhận generic carrier → không publish typed event.
- ~~**Outbox: typed-deserialize fail = dead-letter**~~ — DONE (tech-debt cleanup, commit `301ec75`, phương án (a)): `DeserializeOutboxEvent` nay trả `(IDomainEvent?, Exception? ConcreteFailure)`; khi eventType resolve được nhưng deserialize concrete ném → typed mapper nhận generic carrier → `Map` null, `OutboxProcessor` ném lỗi **dead-letter (poison message)** rõ ràng (kèm event type + inner exception gốc) thay vì message "mapper returned no event" mơ hồ. Fallback generic-carrier cho type chưa đăng ký vẫn giữ nguyên. Có integration test (payload poison `"Data": 42`).
- **Outbox: poison message vẫn tiêu hao retry budget** (NEW, surfaced bởi tech-debt cleanup): entry dead-letter sẽ bị `ResetForRetryAsync` retry tới `MaxRetries` lần dù không bao giờ thành công. Cân nhắc status terminal riêng `DeadLettered` (hoặc skip retry khi `concreteFailure != null`) để poison message không churn. Pre-existing retry behavior, chỉ rõ ràng hơn nhờ diagnostics mới — không block.
- **Outbox: purge row cũ trước khi deploy môi trường dài hạn**: row outbox ghi bằng serialization cũ (thiếu `Data`) sẽ deserialize ra concrete event có `Data == null` → mapper deref `Data.*` → NRE → kẹt `Failed`. Hiện greenfield nên rủi ro ~0; cần drain/purge outbox Pending/Failed cũ trước khi lên env chạy lâu.
- **Outbox: `Type.Name` collision (đa-service tương lai)**: resolver key theo `Type.Name`; nếu 2 event trùng tên ở namespace khác nhau qua nhiều assembly thì overwrite âm thầm. Hiện single-assembly nên không xảy ra; cân nhắc hardening khi scan nhiều assembly.

## Follow-up sau AST-1 Scaffold + Consume

- ~~**Promote `IdempotentEnvelopeConsumer` base class**~~ — DONE (GIS-5 Task 1): lên building-blocks khi consumer thứ 2 xuất hiện (trigger: GIS-5 projection consuming `asset.status.changed`). Tránh copy-paste filter + dedup + core-method.
- **Promote `IsUniqueViolation` (PG 23505) lên `PostgresExceptionHelper` chung** trong building-blocks khi service thứ 2 cần. GIS đã có bản Application-layer; asset-be có bản local trong consumer. Merge khi có yêu cầu thứ 2.
- **Concurrent same-event race (non-blocking)**: unique-violation bị bắt → treat as success, nhưng EF entity vẫn tracked Added → inbox `SaveChanges` ném 23505 → retry → self-heal (lần 2 `HasBeenProcessedAsync` = true). Cân nhắc detach entity / fresh scope cho inbox write nếu spurious retry gây noise. Không mất dữ liệu.
- **`OutboxPublishPipelineTests` chưa assert EventId round-trip**: mapper copy đúng EventId, e2e deliver-twice cover; thêm assertion tường minh trong AST-2.
- **Backfill risk**: nếu asset-be deploy sau khi GIS đã có dữ liệu → cần một lần chạy backfill (`scripts/` — đọc qua API GIS phân trang, không đọc DB GIS trực tiếp). Greenfield hiện tại rủi ro ~0; ghi nhận khi lên môi trường có dữ liệu thật.

## Follow-up sau AST-2 Lifecycle commands

- **Event semantic deferred — `asset.activated` / `asset.maintenance-marked`**: không phát trong AST-2 (không có consumer Phase-1 cần semantic phân biệt). Thêm khi maintenance-be / observation-be yêu cầu (Phase 4/5). Non-breaking: chỉ extend outbox mapper.
- **`BaseException.Code` → ProblemDetails extension** (building-block improvement): rule code (vd `BUSINESS_RULE.InvalidAssetTransition`) hiện chỉ readable qua tiền tố `[RuleCode]` trong `detail` string. Surface ra extension field machine-readable khi FE/integration cần parse code, không phải message.
- **`changedBy` audit trail cho technical profile**: actor trong `UpdateTechnicalProfile` chỉ được ghi vào event payload — không persist vào DB. Wire vào `AssetTechnicalProfile` entity hoặc bảng audit khi nghiệp vụ yêu cầu.
- **Reason-on-suspend/activate**: endpoint `POST /api/assets/{id}/suspend` và `…/activate` không có request body (reason = null). Thêm body optional `{ "reason": "…" }` nếu product cần operator ghi lý do.
- **⚠️ Cross-tenant mutation guard (cross-cutting, gắn US-X-01)**: command handler chỉ yêu cầu *có* tenant context, KHÔNG kiểm tra asset load lên có `TenantId` khớp caller — kẻ biết asset id của tenant khác có thể suspend/decommission/edit. **Không phải regression của AST-2**: GIS command handler dùng đúng pattern này (cùng gap đã ghi ở "Follow-up sau GIS-3 → Tenant check trên endpoint/host refs"). Read-path đã tenant-scoped nên chỉ rò ở mutation. Fix một lần ở repo/handler-base cho cả asset-be + gis-be khi làm US-X-01: sau khi load, `if (asset.TenantId != tenant.TenantId) throw NotFoundException` (404, không 403, tránh lộ id-enumeration) + test cross-tenant bị từ chối.  **— RESOLVED (US-X-01, decision 0016):** mutation handlers (asset 5 lifecycle + gis Relocate/Remove node·pipe·device) now load via tenant-scoped `GetByIdAsync(tenantId, id)` → cross-tenant id 404s, covered by per-service cross-tenant unit + integration tests. Reference guard (b) on endpoint/host refs still deferred. Read-path defence-in-depth (`ExistsAsync`, `AssetReadDao` lifecycle SQL) noted as non-blocking follow-up in decision 0016.
- **`asset.status.changed` thiếu `TenantId` trong payload v1** (chốt theo decision 0012): consumer GIS-5 lấy tenant từ envelope source-aggregate, không từ V1 payload. Xác nhận lại khi build GIS-5 để không bất ngờ.
- **AST-3 TransferAssetOwnership**: `IOrganizationUnitDirectory` port + mock adapter + `AssetOwnership` entity + transfer command — slice tiếp theo của asset-be.

## Follow-up sau GIS-4 GetAssetsInBbox

- ~~**lifecycleStatus deferred**~~ — DONE (GIS-5): bbox response trả `lifecycleStatus: null` — left join `network_asset_states` để dành GIS-5 (bảng projection chưa tồn tại). Field đã ship sẵn (null) nên thêm join sau là non-breaking.
- **Bbox area cap / limit theo config**: `GisQuery:Bbox` (MaxAreaSquareDegrees=1.0, DefaultLimit=2000, MaxLimit=10000) — chặn full-table scan khi FE zoom-out. Cân nhắc tuning per-tenant sau khi có dữ liệu thật.
- **Bulk/cursor export endpoint**: topology-rs (TOP-1) cần `GET /api/network/assets/export?cursor=` để full rebuild graph. KHÔNG thuộc GIS-4 (bbox-limited); thêm khi vào Phase 3.
- **Index eligibility test dùng `enable_seqscan=off`**: `BboxQueryIndexUsageTests` ép planner để assert GiST index áp dụng cho `&&` (tránh flakiness do planner chọn seq scan trên bảng nhỏ). Không phải benchmark hiệu năng thực — nếu cần SLA p99, thêm benchmark trên dataset lớn sau.
- ~~**Truncation không có ORDER BY**~~ — DONE (tech-debt cleanup, commit `771e30d`): bbox DAO nay `... UNION ALL ... ORDER BY id LIMIT @fetchLimit` → membership ổn định giữa các call khi bị cắt. Có test assert thứ tự id tăng dần.

## Follow-up sau GIS-5 Projection

- **`tenant_id` trong projection redundant cho bbox join**: bbox join đúng nhờ `asset_id` (UUID) duy nhất toàn cục; `tenant_id` chỉ phục vụ hygiene + index `ix_asset_states_tenant`. Nếu sau cần query projection độc lập theo tenant thì đã sẵn index.
- **Seed phụ thuộc `asset.registered`**: nếu một asset chưa từng phát `asset.registered` (vd backfill thiếu) thì projection sẽ null tới khi có `status.changed` đầu tiên. Greenfield không vấn đề; lưu ý khi backfill môi trường có dữ liệu.
- **`IsUniqueViolation` (PG 23505) vẫn copy ở asset-be**: promote lên building-blocks khi consumer/handler thứ 3 cần (gis dùng PostgresExceptionHelper Application-layer riêng).
- **Per-event-type exchange routing**: vẫn 1 exchange chung; gis consumer filter theo EventType. Tối ưu routing là follow-up building-block chung.

## Follow-up sau BFF-1 Overview + Map

- **Search endpoint hoãn**: `GET /bff/water-network/assets/search?q=` chưa làm — GIS chưa có search
  upstream. Cần slice GIS-6 (search/filter theo asset_code/type) rồi BFF-n thêm endpoint.
- **YARP gateway route**: BFF chạy như service riêng (port 8083). Gắn route qua gateway thuộc
  cross-cutting US-X (chưa kích hoạt).
- **Overview cần `type` query param**: FE phải truyền `?type=node|pipe|device` (GIS detail tách
  route theo type, không có endpoint hợp nhất). Nếu sau muốn bỏ `type`, thêm `GET /api/network/assets/{id}`
  hợp nhất ở gis-be (GIS-6+) rồi BFF gọi 1:1.
- **Eager `BaseUrl` validation (DI)**: `DownstreamEndpoint.BaseUrl` chưa validate lúc startup —
  cấu hình thiếu sẽ thành 5xx ở request đầu thay vì fail-fast. Thêm `[Required]`/`[Url]` +
  `AddOptionsWithValidateOnStart<DownstreamOptions>()` khi cần hardening deploy. Hiện appsettings có
  default thật nên không gặp `new Uri("")`.
- **Resilience timeout chưa test qua integration**: 5xx→502 cover bằng WireMock; timeout/circuit-open
  cover bằng unit test client (exception→Unavailable). Thêm WireMock `WithDelay` test nếu cần SLA thật.
- **Caching**: chưa có; thêm response cache/ETag khi đo tải thật.
- **Correlation-id forward khi caller bỏ trống**: `AuthForwardingHandler` đọc `X-Correlation-Id` từ
  `ctx.Request.Headers`; nếu client KHÔNG gửi header này thì `CorrelationIdMiddleware` tự sinh id cho
  log/response BFF nhưng KHÔNG ghi ngược vào request headers → handler không forward được xuống
  downstream (đứt trace chéo service cho caller bỏ trống). Blast radius thấp. Fix: đọc id đã sinh từ
  request context/response thay vì chỉ từ request header, rồi forward.
- **Endpoint test cho pipe/device overview**: hiện chỉ unit-test ở client cho cả 3 route; endpoint
  integration test mới phủ `node`. Endpoint type-agnostic nên là gap chấp nhận được — thêm `[Theory]`
  node/pipe/device ở endpoint nếu muốn đóng hẳn.

## Follow-up sau DSN-1 Design Project + Document

- **Real file storage adapter**: `HttpFileStorageAdapter` → platform-core/file-storage-be (presigned
  URL, retention). DSN-1 dùng `LocalDiskFileStorageAdapter` mock. Swap qua `FileStorage:Provider`,
  không đụng Domain/Application (decision #12). Mount volume cho compose khi cần file bền.
- **Orphan file khi DB commit fail sau khi đã lưu file**: hiện chấp nhận (mock local). Thêm
  compensating delete hoặc cleanup job khi lên storage thật.
- **Download document endpoint** + **project list/search** + **Cancel project**: chưa làm (US không yêu cầu DSN-1).
- **DSN-2**: `DesignRevision` state machine + `DraftNetworkAsset` + validation engine + PostGIS
  extension/NTS + preview query.
- **Antiforgery cho multipart**: endpoint dùng `.DisableAntiforgery()`; xem lại khi bật antiforgery toàn cục.
- Upload validation hand-rolled ở endpoint (multipart không qua `.WithValidation<>` filter JSON) + `UploadDesignDocumentCommand` chưa có Application-layer validator → cân nhắc validator dùng chung / guard ở handler nếu cần tái dùng.
- `UploadedBy` fallback về `tenant.TenantId` khi `RequestContext.UserId` null → cân nhắc sentinel `"unknown"` cho audit rõ nghĩa hơn.
- Chưa có FK `design_documents.project_id` → `design_projects.id` (chỉ index). Chấp nhận cho staging + insert-only; cân nhắc khi DSN-2 mở rộng vòng đời document.
- Hai validator trùng rule cho create project (request-level + command-level) — belt-and-suspenders; gộp hoặc ghi chú lý do.

## Follow-up sau DSN-2 Draft assets + Validate

- **Real `HttpGisLookupAdapter`**: DSN-2 dùng `StubGisLookupAdapter` (config `GisLookup:ExistingCodes`).
  Thay bằng adapter gọi gis-be API khi cần check trùng code thật (swap qua `GisLookup:Provider`).
- **Draft create không atomic với revision reset**: khi revision đang `Validated`, create/update draft
  reset revision→Draft qua 2 SaveChanges (revision repo + draft repo). Window nhỏ, tenant-scoped; chấp
  nhận cho staging. Gộp vào 1 transaction nếu cần chặt hơn.
- **Optional-attribute warnings chưa có rule cụ thể**: engine hỗ trợ `warnings[]` nhưng DSN-2 chưa khai
  báo attr optional nào (chỉ required → error). Thêm khi product chốt danh mục attr.
- **Batch all-or-nothing ở request-level**: 1 phần tử sai schema → 400 toàn batch. Không có partial
  success report (để dành DSN-4 publish imported/failed).
- **Delete/clone draft + diff revision**: chưa làm (US không yêu cầu DSN-2).
- **Unknown deviceType bỏ qua host rule**: engine chỉ enforce host cho Valve/FlowMeter/PressureSensor/
  Pump/Hydrant; deviceType lạ → coi hợp lệ. Siết khi chốt danh mục deviceType.
- **DSN-3**: `SubmitDesignRevision`/`ApproveDesignRevision`/`RejectDesignRevision` + permission
  `network-design:approve` + audit transition. ✓ DONE

## Follow-up sau DSN-4

- **Re-publish của failed drafts (sau khi sửa) bị defer** (DSN-5+). `Published` và `PartiallyPublished` là terminal trong DSN-4 — không có cơ chế re-publish.
- **Cross-revision / existing-GIS-asset refs không được hỗ trợ**: `fromRef`/`toRef`/`hostRef` chỉ là `clientRef` nội-batch. Một pipe tham chiếu node bị fail hoặc không có trong batch → pipe đó cũng fail (cascade). Lift giới hạn này khi có use case "kết nối vào mạng hiện có".
- **`design.revision.published` chưa có consumer**: catalog entry đã có; thêm consumer khi notification/audit flow được định nghĩa.
- **Cascade behaviour là có chủ đích** và đã được phủ bởi `PublishRoundTripTests`: khi một endpoint node fail import, pipe phụ thuộc vào node đó cũng fail.
- **`AggregateRepositoryBase` rollback path không gọi `ChangeTracker.Clear()`**: `DesignAssetImportConsumer` compensate bằng cách clear tracker trong per-asset catch. Cân nhắc tập trung clear-on-rollback vào base nếu có consumer batch thứ 2 xuất hiện.
- **`GisImportBatch` là aggregate transient (không có bảng)**: dùng thuần để route `network.gis-import.completed` qua outbox; `GisImportBatchRepository` subclass `AggregateRepositoryBase` với `PersistAsync` là no-op.

## Follow-up sau DSN-3

- **DSN-4 consumes `design.revision.approved`** to trigger publish→GIS (event `design.asset.ready-for-gis`). This is the next slice for design-be.
- **No consumers yet** for `design.revision.submitted` and `design.revision.rejected` — catalog entries exist; add consumers when product defines a notification flow.
- **Approval reason is optional** (`Approve` accepts null reason); **submit has no reason field**; **reject reason is required** (enforced at both domain and validator level).
- **`Approved.Reason` serializes as explicit `"Reason": null`** when null (C# record positional param — System.Text.Json emits the field). DSN-4 consumer contract must handle `"Reason": null` explicitly; do not assume the field is absent.
- **EF auto-generated a redundant shadow FK index** `IX_design_revision_transitions_revision_id` alongside the named composite `ix_revision_transitions_tenant_revision`. This is harmless (both point to `revision_id`); suppress with an explicit `HasForeignKey` shadow-index override or a follow-up migration if schema hygiene matters later.
- **`UpdateDraftGeometryCommandHandler` silently skips the guard** when the revision lookup returns null (`revision?.EnsureDraftsEditable()` — null-conditional call). This is a pre-existing pattern (the handler already had a null-revision early-exit path). Candidate hardening: throw `NotFoundException` on null revision instead of silently continuing. Non-blocking for DSN-3 scope.

## Follow-up sau INC-1 (Report/Classify incident)

INC-1 dựng service `water-network-incident-be` (Clean arch 5 layer, DB `wn_incident`) +
`NetworkIncident` aggregate (state subset `Reported/Classified/Cancelled`, decision 0021),
timeline append-only, query list/detail, GIS-ref verification qua `IGisLookupPort` (stub) →
cờ `unverified` không block. Events `incident.reported/classified/cancelled` v1. Routes
`/api/incidents`. 8 integration test (report/classify/cancel/list/cross-tenant 404) +
15 unit + 3 contract. Compose port 8086.

- **⚠️ Building-block change (blast radius toàn platform)**: INC-1 thêm vào `PlatformWebApiExtensions`
  một `JsonStringEnumConverter` cho minimal-API JSON (enum nhận/trả dạng **string** thay vì số ở MỌI
  service HTTP) + `BadHttpRequestException → 400` trong `GlobalExceptionMiddleware`. Đã verify không
  vỡ test service nào (gis 97, asset 27, bff 13, design 35 integration + toàn bộ unit/contract). Lưu ý:
  service mới từ nay mặc định serialize enum dạng string ở HTTP. Cân nhắc ghi decision riêng nếu cần chuẩn hoá.
- **State machine mở rộng (INC-2/INC-3)**: thêm `IsolationRequested → … → Resolved` + transition tương ứng khi có handler.
- **Real GIS adapter**: thay `StubGisLookupAdapter` bằng HTTP/gRPC gọi gis-be (swap qua `GisLookup:Provider`); INC-2 wire khi cần resolve ref thật + re-verify `unverified`.
- **`network-incident:*` permission**: chưa enforce qua Keycloak thật (US-X); endpoint khai báo `RequirePermission`. `:confirm` thêm ở INC-3.
- **Location lưu kép**: cột `location geometry(Point,4326)` + `longitude/latitude` song song; chưa query không gian — cân nhắc bỏ một biểu diễn nếu review thấy dư.
- **List cap 500 cứng, không phân trang/cursor**: thêm paging khi UI cần.
- **Affected ref immutable sau report (INC-1)**: không update/append ref; thêm khi nghiệp vụ cần.
- **No consumer cho 3 event**: catalog ghi nhận; consumer thêm khi notification/impact flow định nghĩa.

## Follow-up sau INC-2 (Isolation analysis qua gRPC)

INC-2 thêm `RequestIsolationAnalysis` cho incident-be → gọi gRPC `ComputeIsolationZone` của
topology-rs (decisions 0019/0020) — tích hợp .NET→Rust gRPC đầu tiên của platform. Adapter
`GrpcTopologyAnalysisAdapter` (cờ `Topology:Provider` Grpc/Stub swap, mirror `GisLookup:Provider`)
gọi `AddGrpcClient` + `ServiceConfig` retry policy + per-call deadline. Analysis **đồng bộ**: transport
failure ⇒ `IsolationPlan` status `AnalysisFailed` (retry được — incident vẫn ở `IsolationRequested`,
KHÔNG phát event). Plan là snapshot **immutable** (đóng băng `valves_to_close`/`isolated_nodes`/
`isolated_pipes`/`graph_version`) + supersede plan cũ khi re-analyse. Persist ở bảng `isolation_plans`
(cột `text[]` cho list). Event `incident.isolation-plan-created` v1. Decision 0023. Có **contract test
real-container** (Testcontainers dựng image Rust thật) kiểm wire-compat gRPC — **ĐÓNG defer .NET client
contract test của decision 0019**.

- **pipe/device assetRef → node resolution vẫn defer** (decisions 0019/0020): start hiện là node; incident
  trên pipe/device cần resolve về node(s). Thêm khi nghiệp vụ cần.
- **Graph-seeded cross-language e2e defer**: e2e seed graph rồi gọi qua gRPC chưa làm phía .NET (đã phủ
  phía Rust trong TOP-3). Thêm khi cần kiểm chứng full cross-language.
- **Valve open/closed state = Phase 5**: ComputeIsolationZone coi mọi van "đóng được"; refine khi
  `valve.state.changed` (observation) có mặt.
- **`network-incident:confirm` + plan `Confirmed` status + `maintenance.work-order-requested` = INC-3**:
  confirm plan + phát work-order request là slice kế.
- **First-cold Docker build của image topology chậm (~5 phút, build context = repo root)**: CI cần Docker +
  kiên nhẫn (hoặc cache layer) cho contract test real-container.

## Follow-up sau INC-3 (Confirm plan + Handle + Resolve)

INC-3 thêm `ConfirmIsolationPlan`, `StartIncidentHandling`, `ResolveIncident` cho `NetworkIncident`
aggregate: 3 trạng thái mới (`IsolationConfirmed`, `InProgress`, `Resolved`) + `IsolationPlanStatus.Confirmed`.
3 event mới: `incident.isolation-plan-confirmed`, `maintenance.work-order-requested` (FROZEN Phase 3→4
contract), `incident.resolved`. Decision 0024. Đóng Phase 3 (US-P3-05).

- **Non-isolation handling path**: path tắt `Classified → InProgress` (sự cố nhỏ không cần cô lập) chưa
  làm. Hiện tại sự cố không cần cô lập dùng `Cancel`. Thêm khi nghiệp vụ yêu cầu — non-breaking.
- **Chưa có consumer cho 3 event**: `incident.isolation-plan-confirmed`, `maintenance.work-order-requested`,
  `incident.resolved` đã đăng ký event catalog; consumer sẽ đến ở slice riêng (MNT-1, CIM-1).
- **`network-incident:confirm` chưa enforce qua Keycloak thật (US-X)**: endpoint khai báo
  `RequirePermission("network-incident:confirm")` nhưng JWT mock authority chưa validate — tương tự
  `:write` từ INC-1. Siết khi làm US-X (Keycloak thật + client credential).
- **Re-open chưa hỗ trợ**: `Resolved` là trạng thái terminal. Cần `ReopenIncident` command (INC-x tương
  lai) nếu nghiệp vụ cần mở lại.

## Follow-up sau TOP-3 (ComputeIsolationZone)

TOP-3 thêm RPC `ComputeIsolationZone` (valve-segment isolation) cho topology-rs: BFS từ node sự cố qua pipe không van → segment; đóng mọi van trên pipe có van ở biên. Trả `valves_to_close`/`isolated_nodes`/`isolated_pipes`/`graph_version`. Decision 0020. Perf 100k-edge ~120ms < 200ms. E2E grpcurl + integration test.

- **assetRef pipe/device resolution**: start hiện là `start_node_id`. Incident thường ở pipe → cần resolve pipe/device-ref về node(s). Thêm khi INC-2 cần.
- **Global min-cut optimisation**: hiện là valve-segment (minimal theo bố trí van hiện có), không tối ưu toàn cục. Nâng cấp nếu nghiệp vụ cần tập van nhỏ hơn nữa.
- **Valve open/closed state**: TOP-3 coi mọi van là "đóng được". Khi có `valve.state.changed` (Phase 5, observation), refine để chỉ tính van thực sự đóng được / đang mở.
- **Boundary pipe partial-isolation**: pipe có van ở biên KHÔNG nằm trong `isolated_pipes` (chỉ bị cô lập một phần). Nếu UI cần thể hiện phần pipe bị cô lập, bổ sung semantics.
- **INC-2 là consumer thật đầu tiên**: gọi `ComputeIsolationZone` qua gRPC để lưu `IsolationPlan`; đồng thời đóng nốt .NET client contract test đang defer (decision 0019).

## Follow-up sau TOP-2 (ValidateTopology + gRPC)

TOP-2 thêm gRPC (tonic, package `waternetwork.topology.v1`) cho topology-rs: `ValidateTopology` (orphan/missing-endpoint/disconnected component), `TraceNetwork` (BFS giới hạn độ sâu, vô hướng), `FindNearestValves`; mỗi response kèm `graph_version`; gRPC health. Decision 0019. E2E verify thật qua grpcurl (consume RabbitMQ → graph → gRPC).

- **.NET client contract test defer sang INC-2**: incident-be (caller gRPC đầu tiên) chưa tồn tại. Proto `proto/topology.proto` là contract chung; TOP-2 chỉ test server phía Rust (in-process server↔client). Khi làm INC-2: thêm .NET client + contract test gọi container topology thật (Testcontainers) như roadmap §8.3.
- **assetRef resolution**: trace/nearest hiện chỉ nhận `start_node_id`. Incident thường ở trên pipe/device → cần resolve pipe/device-ref về node(s). Thêm khi INC-2 cần (hoặc TOP-x).
- **Flow-direction trace**: graph vô hướng; `TraceNetwork` chưa có direction (upstream/downstream). Thêm khi mô hình hoá hướng dòng chảy / hydraulic.
- **Per-tenant `graph_version`**: hiện trả global counter `TenantGraphs::version()`. Refine thành version theo tenant nếu cần.
- **ComputeIsolationZone = TOP-3** (cut-set minimal valve set, BFS dừng tại van đóng được + benchmark p99).
- **Isolated-placeholder cleanup**: `remove_pipe` không xoá node placeholder (registered=false) khi nó mất cạnh cuối → validate báo MissingEndpoint cho node degree-0 unregistered. Cân nhắc cleanup tương tự orphaned-device.
- **gRPC server reflection**: chưa bật (grpcurl phải truyền `-proto`). Thêm `tonic-reflection` nếu muốn `grpcurl list` không cần proto.
- **Spawned-task panic không hạ process** (final review, Minor): gRPC server + HTTP health chạy trong `tokio::spawn` mà `JoinHandle` bị drop → nếu bind/serve fail, task chết âm thầm, process vẫn sống nhờ consumer loop (gRPC port chết nhưng liveness không fail). Cân nhắc `tokio::try_join!`/`select!` để lỗi fatal của server hạ process cho orchestrator restart. Pattern này pre-existing từ health server (TOP-1).

## Follow-up sau TOP-1 (topology-rs scaffold + graph từ events)

TOP-1 dựng service Rust đầu tiên (`src/services/water-network-topology-rs/`): consumer RabbitMQ (lapin) → per-tenant in-memory graph (petgraph), idempotent theo `EventId`, warm-up snapshot, `/health`; cộng endpoint `GET /api/network/assets/export` keyset trên gis-be. Decisions 0017 (graph model) + 0018 (warm-up/consumption). E2E đã verify Rust consumer thật qua RabbitMQ (publish node.registered → graphVersion 1; publish lại cùng EventId → vẫn 1, idempotent).

- **Exchange name re-confirm**: tên exchange MassTransit dùng default URN `WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope` (đã verify phía Rust consumer declare/bind/consume e2e). CHƯA chạy được full compose stack e2e gis-be→topology-rs vì host port 5432/5672 đang bị `platform-core` chiếm — re-confirm gis-be publisher phát đúng tên này khi chạy được stack trên port rảnh (hoặc remap port trong compose override).
- **Full-rebuild path (TOP-1 deferred)**: `GisRebuildClient` + `Config.gis_base_url/gis_token/export_page_size` đã code + test (wiremock) nhưng CHƯA wire vào `main` (đánh dấu `#[allow(dead_code)]` "wired in TOP-2 full-rebuild path"). Warm-up hiện chỉ snapshot-first; multi-tenant enumeration cho rebuild defer. Wire khi cần (TOP-2/TOP-3 drift reconciliation).
- **Service-to-service auth cho export**: endpoint export yêu cầu `network-gis:read`; rebuild client gửi bearer token qua env `TOPOLOGY_GIS_TOKEN`. Thay bằng system identity / mock token factory (roadmap §15.2) khi build TOP-2.
- **gRPC (TOP-2)**: `ValidateTopology`/`TraceNetwork`/`FindNearestValves` qua tonic + proto `waternetwork.topology.v1`; mọi response kèm `graphVersion`. Isolation `ComputeIsolationZone` là TOP-3.
- **`valve.state.changed` (open/closed)**: TOP-1 chỉ coi van (DeviceType=="Valve" host trên pipe) là attribute tồn tại trên edge; trạng thái đóng/mở để tính cut-set thực sự là Phase 5 (observation) consume.
- **Inbox tăng vô hạn (Important, final review)**: `TenantGraphs.processed: HashSet<String>` (dedup theo `EventId`) không bao giờ evict → RAM + snapshot phình theo thời gian cho service chạy lâu. TOP-1 chấp nhận (scaffold). Cần bound: time/size-based eviction hoặc per-tenant LRU, hoặc tận dụng `OccurredAt` để TTL — làm khi tiến tới production (TOP-2/3).
- **Snapshot store**: hiện ghi file đĩa (`TOPOLOGY_SNAPSHOT_PATH`, mỗi 30s, atomic temp+rename); cân nhắc Redis khi cần chia sẻ/độ bền cao hơn.
- **`.dockerignore`**: đã thêm để loại `target/` (~1GB) khỏi build context.
- **relocate là geometry-only**: `network.node.relocated` không đổi topology trong TOP-1 (chỉ đảm bảo vertex tồn tại); khi cần toạ độ cho hydraulic/elevation thì extend payload/export (export hiện bỏ geometry).
