# SHW MVP 03 — Publish recovery và nghiệm thu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kết quả xuất bản có thể đối soát/phục hồi, rồi nghiệm thu MVP SHW bằng journeys thật và restore/rollback evidence.
**Architecture:** Giữ atomic network-edit batch đã có. GIS lưu durable publication receipt cùng transaction; Design consume hoặc pull reconciliation qua API để khép kín trạng thái. Sửa failure bằng revision mới được duyệt, không mở khóa published revision hoặc reapply successful operations.
**Tech Stack:** .NET 10/PostGIS/RabbitMQ/outbox, Design/GIS/BFF, SolidJS, Playwright, K3s/APISIX và S3-compatible storage hiện có.
**Spec:** `../specs/2026-10-03-shw-network-records-mvp-completion-design.md` — approved.
**Status:** Approved — người dùng duyệt ngày 2026-10-03, inline execution. Chưa bắt đầu; prerequisites: MVP 01 và 02 phải verified. Deploy/UAT cần approval riêng.

## Global Constraints

- Approval không đồng nghĩa mọi thao tác đã được xuất bản.
- Retry không tạo duplicate; thao tác đã thành công không bị áp dụng lại.
- Recovery không yêu cầu sửa DB thủ công.
- Không hứa distributed transaction toàn revision. Partial result được biểu diễn minh bạch.
- Backup/restore drill trên fixture; không deploy, merge/push, đổi quyền hoặc mutate SHW mà không có approval phù hợp.
- Với mạng đã publish, sửa bằng revision bù trừ được duyệt, không rollback DB hoặc khôi phục backup đè dữ liệu vận hành.
- Bằng chứng ghi trong chính plan: command, count/result, commit/WIP scope, fixture, image digest khi deploy và artifact path.
- Paths tương đối repo root; verifier từ MVP 01 dùng cho từng suite/all.

## Review Focus

1. Completion được deliver-twice/khác event ID cùng kết quả không được phá receipts/history — Task 1.
2. Completion mất, outbox bị retention-cleanup vẫn phải lấy durable result mới, không reapply — Task 1.
3. Historical receipt thiếu payload không được bị trình bày thành thành công toàn bộ — Task 1/3.
4. Retry request mất response rồi gửi lại không tạo hai revision; successful op không xuất hiện lại — Task 2.
5. Previous FE image hoạt động với additive migrations/routes; rollback không làm mất published edits — Task 5.

## File map

`GIS` = `water-network/water-network-be/src/services/water-network-gis-be`; `Design` = sibling `water-network-design-be`; `BFF` = sibling `water-network-bff`; `FE` = `water-network/water-network-fe/apps/gis/src`.
Files dưới `<service> <Layer>/...` là `<service>/src/WaterNetwork.<Gis|Design|Bff>.<Layer>/...`; tests nằm trong `<service>/tests/WaterNetwork.<Gis|Design|Bff>.<test-kind>/`. FE publication files cùng folder `pages/gis/network-editor/`; BFF proxy là `BFF/src/WaterNetwork.Bff.Api/Endpoints/NetworkEditorEndpointModule.cs`. Migration EF generate timestamp và ghi evidence.

## Quyết định recovery

- NetworkEditsPublishConsumer hiện áp dụng atomic batch; inspection error reject **toàn batch**. Giữ semantics này, không chuyển sang partial apply để phù hợp tên PartiallyPublished. CAD có partial result riêng; UI hiển thị đúng per-op receipts.
- Lưu `NetworkGisImportCompletedV1` result JSON trong network-edit batch receipt, không dựa vào outbox tồn tại mãi. Migration additive nullable cho legacy rows.
- Historical receipt thiếu JSON: chỉ phục hồi từ retained completion payload/ledger nếu đầy đủ và chứng minh được; nếu không đủ trả `unavailable`, không đoán lý do/thành công và không reapply. Ghi trường hợp cần operator rà soát, không sửa DB tự động.
- Failed operations được copy sang revision mới cùng project, link source revision/operation. Review/validate/submit/approve lại với current before/expectedVersion. Không sửa terminal revision và không reset GIS ledger.

## Task 1: Durable receipt và Design reconciliation atomic

**Files:** Modify GIS `Infrastructure/Persistence/NetworkEditBatchPersistenceModel.cs`, `Configurations/NetworkEditBatchConfiguration.cs`, `Consumers/NetworkEditsPublishConsumer.cs`; EF additive migration `AddNetworkEditResultPayload`; Create GIS Contracts `Responses/NetworkEditResultResponse.cs`, Api `Endpoints/NetworkEditResultsEndpointModule.cs`, Infrastructure `NetworkEditing/NetworkEditReceiptReader.cs`; Modify Design `Application/Ports/IGisLookupPort.cs`, `Infrastructure/GisLookup/HttpGisLookupAdapter.cs`, `Consumers/GisImportCompletedConsumer.cs`, `Repositories/DesignImportResultStore.cs`; Create Design `Application/Ports/IPublicationResultApplication.cs`, Api `Endpoints/NetworkEditRecoveryEndpointModule.cs`, Infrastructure `Publication/PublicationResultApplication.cs` dùng DesignDbContext; BFF editor proxy route; tests GIS `NetworkEditReceiptApiTests.cs`, Design `PublicationReconciliationTests.cs`, extend existing consumer tests.
**Interfaces:** GIS `GET /api/network/network-edit-results/{revisionId}` read permission → `{revisionId,status:"applied"|"rejected"|"unavailable",result:NetworkGisImportCompletedV1|null}`; missing/wrong tenant 404. `NetworkEditResultResponse(string RevisionId,string Status,NetworkGisImportCompletedV1? Result)` trong GIS Contracts; `IGisLookupPort.GetNetworkEditResult(string tenantId,string revisionId,CancellationToken ct):Task<NetworkEditResultResponse?>`, null cho404, transport error không được diễn giải như missing. Design `POST /api/design/revisions/{id}/network-edits/reconcile` `{expectedVersion}` write permission; BFF `/api/gis/editor/revisions/{id}/reconcile`. `IPublicationResultApplication.ApplyAsync(NetworkGisImportCompletedV1 result,string actorId,string? correlationId,CancellationToken ct):Task` stores result rows + revision transition atomically, same implementation used by consumer and reconcile.

- [ ] **Step 1: Viết tests** `Receipt_And_Mutation_Commit_Or_Roll_Back_Together`, `Lost_Completion_Reconciles_Without_Reapplying`, `Duplicate_Completion_Preserves_Result`, `Conflicting_Completion_Cannot_Overwrite_Terminal_Result`, `Historical_Receipt_Without_Result_Is_Unavailable`, `Result_Foreign_Tenant_Is_404`. Assertions: faults after rows before revision update leave neither committed; outbox delete in isolated fixture does not remove receipt result; asset version/geometry count unchanged after reconcile; conflicting payload không overwrite accepted result.
- [ ] **Step 2: Run** `dotnet test water-network/water-network-be/src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter FullyQualifiedName~PublicationReconciliationTests --nologo`. Expected: RED result pull/atomic application chưa có.
- [ ] **Step 3: Persist durable JSON cùng GIS mutation/rejected batch transaction.** Build receipt/result một lần, reused outbox completion. Redelivery existing terminal receipt không apply lại; migration không fabricate payload. Existing accepted ledger detection phải SaveChanges receipt nếu cần, không tạo success từ incomplete ledger.
- [ ] **Step 4: Implement atomic Design application và reconcile.** Network edit expected operation IDs/count phải khớp snapshot locked; tenant envelope/payload phải đồng nhất khi envelope có tenant. Consumer CAD giữ existing v1 compatibility. Idempotent same canonical result, reject conflicting rewrite; transaction result rows/status/audit cùng DesignDbContext, CAS retry đọc latest. Reconcile chỉ pull result, không phát publish command. Permission/body version check; unavailable/pending hiển thị chưa đối soát.
- [ ] **Step 5: Run GIS/Design/BFF verifier.** Expected: GREEN including existing PublishRoundTripTests, race/redelivery/rejected batch tests; commit `feat(network): persist publication receipts and reconcile lost results`.

## Task 2: Revision phục hồi chỉ chứa thao tác thất bại

**Files:** Extend ADR của MVP 02; Create Design `Application/Commands/CreateRecoveryRevisionCommand.cs`/handler, Infrastructure persistence/config for recovery link and idempotency request; additive migration `AddNetworkEditRecoveryLinks`; Modify NetworkEditRecoveryEndpointModule, DesignRevisionRepository, network-edits GET DTO; Modify BFF editor routes; extend Design `IntegrationTests/RecoveryRevisionApiTests.cs`, Unit `RecoveryRevisionMappingTests.cs`.
**Interfaces:** Design `POST /api/design/revisions/{id}/network-edits/recovery` body `{expectedVersion,requestId,operationIds?:string[]}` → `{revisionId,sourceRevisionId}`; `CreateRecoveryRevisionCommand(string RevisionId,int ExpectedVersion,string RequestId,IReadOnlyList<string>? OperationIds):ICommand<string>`; BFF `/api/gis/editor/revisions/{id}/recovery`, write permission. Unique request key `(tenantId,sourceRevisionId,requestId)`; cùng key/body khác →409; optional operationIds chỉ chọn subset failed (missing → tất cả failed), không cho imported IDs hoặc empty set. Recovery DTO exposes `sourceRevisionId` and per-op source mapping. New revision Draft/attributed, failed operations get new IDs, target before/expectedVersion từ current GIS, imported refs được resolve bằng durable successful receipts. Stable GIS target IDs giữ nguyên.

- [ ] **Step 1: Viết tests** `Recovery_Only_Copies_Failed_Operations`, `Same_Request_Returns_Same_Revision`, `Recovery_Needs_New_Approval`, `Concurrent_Source_Change_Is_Reviewable_Not_Overwritten`, `Foreign_Or_Published_Revision_Cannot_Be_Recovered`, `Missing_Result_Cannot_Create_Recovery`. Assertions: imported operation excluded; two POST same key/concurrent → one revision; original snapshot/ledger/result unchanged; new status Draft, no ready event until approval; source link persists reload.
- [ ] **Step 2: Run** `dotnet test water-network/water-network-be/src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter FullyQualifiedName~RecoveryRevisionApiTests --nologo`. Expected: RED recovery route missing.
- [ ] **Step 3: Implement transaction/idempotency và mapping.** Only terminal failed network-edit result eligible; CAD recovery remains existing import workflow, not silently converted. Rehydrate current before/reference versions, retain proposed after for human review; stale targets hiển thị source/current diff; missing targets →422 `RecoveryTargetMissing` trước tạo revision, không sửa canonical hoặc tự gán host. Deleted target operation đã fulfilled báo explicit no-op để người dùng loại khỏi operationIds lần thử mới; không fabricate target. Unresolved dependencies chặn submit, imported references map actual GIS IDs. Max2000 operations giữ validator contract.
- [ ] **Step 4: Run Design/GIS/BFF verifier.** Expected: GREEN; recovery create actor from verified principal, creator cannot approve theo MVP 02; commit `feat(design): create audited recovery revisions for failed edits`.

## Task 3: UI trạng thái publish, receipt và phục hồi không báo xanh giả

**Files:** Modify FE `pages/gis/network-editor/{api.ts,model.ts,workspace.tsx}`; Create `publication-panel.tsx`/tests; extend `workspace.test.tsx`. Data orchestration giữ module MVP 02; không tăng component monolith.
**Interfaces:** `results(id)` giữ existing rows; `reconcile(revision)` calls Task 1; `recover(revision,requestId,operationIds?:string[])` calls Task 2; `PublicationPanel` consumes revision+per-op results+callbacks. `Approved` = processing; `Published` chỉ full success backend result; `PartiallyPublished` hiển thị counts/imported/failed, gồm atomic reject case 0 imported.

- [ ] **Step 1: Viết tests** `approve_200_does_not_mean_published`, `polling_stops_on_scope_change_and_terminal_status`, `each_operation_shows_its_receipt`, `unavailable_receipt_is_not_success`, `recovery_lost_response_reuses_request_id`, `recovery_opens_new_draft_without_unlocking_original`. Assertions: no success notice on pending; stop timers/abort on cleanup; failure reasons tied operation; reconcile error keeps current data; draft retry requires validate+submit+separate approve.
- [ ] **Step 2: Run** `npm --prefix water-network/water-network-fe/apps/gis run test:run -- src/pages/gis/network-editor/publication-panel.test.tsx src/pages/gis/network-editor/workspace.test.tsx`. Expected: RED manual button hiện chưa render receipts/recovery.
- [ ] **Step 3: Implement scoped result refresh.** Poll Approved every 2s while page active, stop after 60s with explicit still-processing + manual refresh/reconcile; no client timeout → terminal Failed assumption. Terminal status fetch per-op rows; refetch canonical viewport/list/profile, không full tenant. Recovery click reuses UUID until outcome known; double-click disabled; show source/current before differences before re-submit. Known atomic reject label không gọi là partial success.
- [ ] **Step 4: Run FE verifier.** Expected: GREEN, size budget giữ, stale result response cannot mutate new scope. Commit `feat(gis-editor): show publication receipts and recovery journeys`.

## Task 4: Fixture an toàn và browser journeys thật

**Files:** Create `water-network/water-network-fe/apps/gis/e2e/shw-network-records.spec.ts`, `e2e/helpers/network-fixture.ts`; Create `water-network/water-network-be/scripts/shw-mvp/fixture.sh`, `fixture.compose.yml`, `test_fixture_safety.py`. Không commit credentials hoặc original DWGs.
**Interfaces:** `fixture.sh up|down` isolated Compose/dbs + tenant A/B + creator/reviewer; manifest JSON chứa owned resource names, safe fixture marker, fixture-only endpoints và counts. `SHW_MVP_E2E_BASE_URL` trỏ fixture; token fixture files ngoài git. `network-fixture.ts` seed/cleanup bằng public APIs của fixture, không route-intercept/mock mutation backend.

- [ ] **Step 1: Viết guard tests và browser assertions trước wiring.** `fixture_rejects_nonfixture_target` assert missing marker/live target →nonzero trước side effect. Browser tests: tenant A/B search/profile; outside viewport; row201/10000; save/reload; stale conflict; Node→Pipe→Device→move/split/connect; validate→submit→separate approve→map; broker pause/resume; lost completion→reconcile; failed→recovery; CAD valid/invalid CRS và repeat import. Tests không skip khi thiếu fixture.
- [ ] **Step 2: Run** `python3 -m unittest discover -s water-network/water-network-be/scripts/shw-mvp -p 'test_fixture_safety.py'`. Expected: RED scripts/guard thiếu. Run Playwright test collection, Expected: journeys discover >0; chưa coi collection là execution pass.
- [ ] **Step 3: Implement fixture tooling/test wiring.** Dedicated containers/network/volumes; existing PostGIS/Rabbit/S3 config; test principals chỉ fixture host, không production auth bypass. Cleanup chỉ resources manifest sở hữu. Browser reads/writes qua real BFF, faults injected trong isolated fixture broker/outbox, không SHW production.
- [ ] **Step 4: Run** `fixture.sh up` rồi `npm --prefix water-network/water-network-fe/apps/gis run test:e2e -- e2e/shw-network-records.spec.ts` và guard unittest. Expected: GREEN với test count >0; requirements đã có source có thể pass ngay, ghi evidence và không reimplement để tạo RED giả. New behavior fixes vẫn phải có regression RED→GREEN. Cleanup bằng owned manifest. Commit `test(network): verify SHW MVP journeys against isolated services`.

Ví dụ browser assertion khi setup creator/reviewer fixture xong:
```ts
await creatorPage.getByRole('button', { name: 'Gửi duyệt', exact: true }).click()
await expect(creatorPage.getByRole('button', { name: 'Duyệt cập nhật mạng', exact: true })).toBeDisabled()
```
Server self-approval đã có test MVP02; assertion này chứng minh UI không khuyến khích thao tác trái chính sách.

## Task 5: Restore drill và rollback compatibility gate

**Files:** Create `water-network/water-network-be/scripts/shw-mvp/restore-drill.sh`, `release-check.sh`, `test_restore_release_safety.py`; Create `water-network/water-network-be/docs/reports/2026-10-03-shw-mvp-release-gates.md`; Modify core `RUNBOOK.md`, SHW overlay `README.md`, FE `apps/gis/RELEASING.md`.
**Interfaces:** `restore-drill.sh --fixture <manifest>` restores vào containers/db/bucket mới do manifest sở hữu, không SHW runtime; `release-check.sh --render` read-only local render + validates immutable digests/evidence. Không deploy trong scripts; artifact manifest từ Task4.

- [ ] **Step 1: Viết tests** `restore_refuses_live_database_or_bucket`, `release_requires_digest_and_test_evidence`; assert nonzero trước side effect khi missing marker/live endpoint/mutable tag. Run `python3 -m unittest discover -s water-network/water-network-be/scripts/shw-mvp -p 'test_restore_release_safety.py'`. Expected: RED scripts thiếu.
- [ ] **Step 2: Implement guarded drill.** Backup fixture DB+bucket+metadata, restore new isolated instance; verify checksums/document linkage/drafts/GIS receipts/outbox/counts. Sau restore/restart, pending outbox replay không duplicate asset. Không đọc credential production vào report. Previous-image compatibility test chỉ chạy images có provenance đã được xác minh; thiếu image → gate blocked, không giả green.
- [ ] **Step 3: Run** verifier `--suite all`, E2E Task4, `restore-drill.sh --fixture <fixture-manifest-path>`, `bash deploy/k3s/water-network-core/verify.sh --render`, `release-check.sh --render`, `git diff --check`. Expected: GREEN/counts >0, .NET0 warning, FE0 errors/budget không tăng; APISIX bootstrap/map/assets/editor đúng; latest+previous FE trên additive migrated fixture; rollback config/image giữ published assets. Commit `test(network): gate SHW release on restore and rollback evidence`.

## Task 6: Deploy có approval và nghiệm thu cán bộ SHW

**Files:** Create `water-network/water-network-be/docs/reports/2026-10-03-shw-mvp-acceptance.md`; update SHW overlay release metadata và `docs/orchestration/ROADMAP.md` chỉ state SHW liên quan.
**Interfaces:** Consumes verified release gates Task5, commit/image digests, migration/config diffs; Produces source/merged/deployed/smoke/accepted evidence tách riêng, sign-off người dùng. Đây là operator verification task, không thêm code nên không RED giả.

- [ ] **Step 1: Chốt artifact và xin approval deploy/UAT.** Report digests/migrations/route diff/known limits/security/restore evidence. Không tự push/deploy/cấp account/mutate SHW. Chưa approval/provenance → `source verified; deployment pending`, task incomplete.
- [ ] **Step 2: Sau approval thực hiện rollout compatible backend trước FE, smoke read-only SHW.** Record actual image digests, API authenticated200/unauthenticated401/permission403, vị trí/counts do cán bộ SHW xác nhận. Mutation journey trên tenant fixture đã được chỉ định; không tạo draft hoặc sửa tài sản vận hành SHW để smoke.
- [ ] **Step 3: Cán bộ SHW nghiệm thu.** Tra cứu/hồ sơ trên SHW; biên tập/duyệt trên fixture; cách xử lý conflict/failure và giới hạn source data phải hiểu rõ. Expected: explicit human acceptance hoặc rejection/blocker, không tự ký thay.
- [ ] **Step 4: Update checkbox/evidence/state và commit docs scope nhỏ** `docs(network): record SHW MVP acceptance and rollback evidence`. Không gán done cho platform đa đơn vị hoặc OBS/HYD/CIM.

## Completion và chuẩn hóa tiếp theo

- [ ] Source/tests/E2E/restore/compatibility verified và review xong.
- [ ] Deployment/smoke/acceptance bằng evidence mới và approval đúng; không dùng historical SHW screenshots thay UAT.
- [ ] Các giới hạn dữ liệu nguồn SHW ghi rõ; chưa xác minh không được quảng bá như fact chính thức.
- [ ] State orchestration tách source verified/merged/deployed/smoke/accepted; legacy retirement cần sign-off riêng.

Sau MVP SHW accepted mới brainstorm chuẩn hóa đa đơn vị/nền tảng. Không dựng abstraction/telemetry/simulation trong plan này.
