# SHW MVP 02 — Editor và phê duyệt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cán bộ SHW lưu/mở lại và gửi duyệt thay đổi Node/Pipe/Device mà không mất dữ liệu, làm hỏng quan hệ hoặc tự duyệt.
**Architecture:** Mở rộng WIP canonical editor, giữ Design revision CAS và GIS validation authoritative. Dữ liệu viewport tách khỏi snapshots đang biên tập; không dùng tập feature nhìn thấy làm toàn bộ mạng khi validate.
**Tech Stack:** .NET 10/PostGIS, Design events/outbox, SolidJS/map-runtime, Vitest và PostgreSQL integration tests.
**Spec:** `../specs/2026-10-03-shw-network-records-mvp-completion-design.md` — approved.
**Status:** Approved — người dùng duyệt ngày 2026-10-03, inline execution. Chưa bắt đầu; prerequisite: MVP 01 phải verified. Không tick lại plan editor lịch sử để thay evidence mới.

## Global Constraints

- Published network chỉ đổi khi thao tác đã được duyệt và GIS chấp nhận áp dụng.
- Tenant, actor không nhận từ payload không tin cậy. Cross-tenant asset/revision/reference trả 404.
- Sau mutation thành công, response/refetch server là source of truth.
- Reload chỉ bảo đảm khôi phục dữ liệu đã lưu server; phải cảnh báo trước khi rời màn hình có thay đổi chưa lưu.
- Submit khóa nội dung. Mọi mutation làm validation cũ mất hiệu lực.
- Người gửi không tự duyệt revision của mình trong MVP; người duyệt có capability đúng tenant.
- Undo/redo chỉ áp dụng nội dung có quyền sửa, không thay đổi revision đã khóa.
- Giữ WIP/import/legacy; không mutate SHW, đổi quyền hoặc deploy khi chưa có approval.
- Paths tương đối repo root `water-platform/`. Verification command Task 2 MVP 01: `bash water-network/water-network-be/scripts/shw-mvp/verify.sh --suite <suite>`.

## Review Focus

1. Dependency ở ngoài viewport vẫn phải được xử lý khi move/delete — Task 1/3.
2. Một save thành công về trễ sau đổi user/tenant không được ghi dữ liệu vào session mới — Task 2.
3. Click split lệch khỏi line hoặc trùng segment zero-length không được tạo tuyến gãy sai — Task 3.
4. Người có cả write+approve vẫn không được tự duyệt; historical revision thiếu creator không được gán actor giả — Task 4.
5. Mutation đồng thời validate/save/submit phải không để validation cũ được gửi duyệt — Task 5.

## File map

`GIS` = `water-network/water-network-be/src/services/water-network-gis-be`; `Design` = sibling `water-network-design-be`; `BFF` = sibling `water-network-bff`; `FE` = `water-network/water-network-fe/apps/gis/src`.
Files dưới `<service> <Layer>/...` là `<service>/src/WaterNetwork.<Gis|Design|Bff>.<Layer>/...`; test `IntegrationTests|UnitTests/Foo.cs` là `<service>/tests/WaterNetwork.<Gis|Design|Bff>.<test-kind>/Foo.cs`. BFF endpoints/Program thuộc `WaterNetwork.Bff.Api`. Migration EF generate timestamp, không viết designer tay.

## Quyết định contract của plan

- New bounded snapshot routes không đổi response của legacy `/editor/assets` không query trong rollback window.
- Recovery cache MVP bị bỏ: server persistence là cam kết; không giữ localStorage drafts chứa hồ sơ mạng thiếu expiry. Existing recovery key đúng namespace được xóa khi gặp; không quét/xóa storage của app khác.
- Revision mới ghi CreatedBy từ verified principal; submitted transition giữ actor. Chặn approve bởi creator **hoặc** latest submitter. Actor missing/unknown bị chặn, không dùng chuỗi `unknown` như identity hợp lệ.
- Revision lịch sử không có creator giữ null (không backfill giả); network edit thiếu attribution không được approve mới, báo `RevisionActorUnknown` và dùng revision thay thế có attribution. CAD đã published không bị đổi; CAD submitted kiểm tra submitter hiện có và migration policy phải được ghi trước deploy.
- Routes editor mới nhận expectedVersion cho lifecycle actions; routes CAD cũ giữ compatibility, vẫn enforced domain permissions/separation-of-duty khi có attribution. Không sửa v1 publish schema chỉ để thêm UI status.

## Task 1: Bounded viewport và snapshot dependencies cho editor

**Files:** Modify GIS `Infrastructure/NetworkEditing/NetworkEditInspector.cs`, Api `Endpoints/NetworkEditingEndpointModule.cs`; Create GIS Infrastructure `NetworkEditing/EditorSnapshotReader.cs`, Application `Dtos/EditorSnapshotDto.cs`; Modify GIS Api `Program.cs`, BFF `Endpoints/NetworkEditorEndpointModule.cs`, `Program.cs`; Create GIS tests `IntegrationTests/EditorSnapshotApiTests.cs`; Modify BFF `IntegrationTests/NetworkEditorProxyTests.cs`.
**Interfaces:** GIS `GET /api/network/editor-assets/viewport?bbox=&limit=` → `{assets:Dictionary<string,NetworkEditAsset>,bbox,truncated}`; `POST /api/network/editor-assets/resolve` `{ids:string[]}` → `{assets,complete:true}`. `EditorSnapshotReader.ReadViewportAsync(string tenantId,Bbox bbox,int limit,CancellationToken ct)` and `ResolveAsync(string tenantId,IReadOnlyList<string> ids,CancellationToken ct)`. Public same suffixes under `/api/gis/editor/assets/`. Defaults viewport 2000/max10000, resolve max100 root IDs and max10000 closure assets; overflow → 422 `DependencySetTooLarge`, never silently truncate edit closure.

- [ ] **Step 1: Thêm tests** `Viewport_Does_Not_Return_Full_Tenant`, `Resolve_Node_Includes_Offscreen_Pipes_And_Their_Endpoints`, `Resolve_Pipe_Includes_Hosted_Devices_And_Endpoints`, `Resolve_Foreign_Root_Is_404`, `Dependency_Overflow_Is_422`. Assertions: viewport outside assets absent; closure includes offscreen direct dependents/reference targets; foreign ID không là empty success; caps explicit. Closure không recursive toàn connected component: target nodes → incident pipes → endpoints + hosted devices; target pipes → endpoints + hosted devices; target devices → host + host endpoints.
- [ ] **Step 2: Run** `dotnet test water-network/water-network-be/src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter FullyQualifiedName~EditorSnapshotApiTests --nologo`. Expected: RED routes thiếu.
HTTP permission assertion với authenticated fixture:
```csharp
(await foreignClient.PostAsJsonAsync("/api/network/editor-assets/resolve", new { ids = new[] { tenantARootId } }))
    .StatusCode.Should().Be(HttpStatusCode.NotFound);
```
`tenantARootId` là node tạo bằng API tenant A trong chính test; `foreignClient` dùng verified tenant B token.

- [ ] **Step 3: Implement bounded reader và proxy.** SQL/EF tenant+deleted scope mọi query, versions chính xác, finite bbox validation reuse. BFF proxy allowlists bbox/limit query và resolve body, không nhận upstream từ caller. Tạo client `network-editor` riêng với timeout30s, redirects off, AuthForwardingHandler MVP01/4 và **không retry mutation**; không đổi streaming CAD client. Map HttpRequestException/timeout/malformed JSON sang502, missing Design config trả503 rõ. Add proxy tests `Mutation_Is_Sent_Once_On_Timeout`, `No_Caller_Correlation_Still_Gets_Generated_Header`, `Spoofed_Tenant_Cannot_Override_Context`. Giữ inspector final validation trên authoritative server graph; không thay full graph bằng partial closure khi publish.
- [ ] **Step 4: Run GIS/BFF verifier.** Expected: GREEN, closure không làm reference sai, API permissions đúng; commit `feat(network): add bounded editor snapshots and dependencies`.

## Task 2: Editor viewport, session safety và server-only recovery

**Files:** Modify FE `pages/gis/network-editor/{api.ts,model.ts,workspace.tsx,workspace.test.tsx}`; Create adjacent `editor-data.ts`/tests và `api.test.ts`; reuse `pages/gis/lib/viewport-bbox.ts`. Tách data/session orchestration ra `editor-data.ts`, không refactor toolbar/import ngoài scope.
**Interfaces:** API `viewport(bbox,limit):Promise<{assets:State,bbox,truncated}>`, `resolve(ids:string[]):Promise<{assets:State,complete:true}>`; `createEditorData` exposes scoped viewport state + pinned edit-base state, abort/dispose; `State`/`Edit` giữ contract WIP. Pin snapshots khi chọn sửa, không replace expectedVersion bởi viewport refresh.

- [ ] **Step 1: Viết tests** `viewport_and_pinned_drafts_survive_pan`, `late_save_after_session_change_is_ignored`, `reload_uses_server_without_localStorage`, `leave_or_switch_revision_warns_on_dirty`, `read_only_user_has_no_mutation_actions`. Assertions: no unbounded `assets()` on mount/open/save; unresolved closure disables move/delete; new scope state/undo/redo/reason/issues clear; API 409 không mất dirty edits.
- [ ] **Step 2: Run** `npm --prefix water-network/water-network-fe/apps/gis run test:run -- src/pages/gis/network-editor/editor-data.test.ts src/pages/gis/network-editor/api.test.ts src/pages/gis/network-editor/workspace.test.tsx`. Expected: RED full-load/local cache/stale-save path hiện tại.
- [ ] **Step 3: Implement viewport + pinned base store.** Reuse controller Task 5 MVP 01; union draft snapshots/before/after riêng với visible viewport; `resolve` trước thao tác dependent. Scope tất cả asynchronous write-backs bằng captured epoch, không chỉ phần catch/finally. Xóa cache namespace `wn-network-edit:<current scope>:` đúng keys; bỏ remember/restore. Server save response update snapshot/revision, failure giữ dirty. Warn before unload/hash navigation/switch revision; cancel navigation khi người dùng chọn giữ.
- [ ] **Step 4: Run FE verifier.** Expected: GREEN, không localStorage draft recovery, không bỏ draft khi pan; commit `fix(gis-editor): scope async state and use bounded server snapshots`.

## Task 3: Split/connect/move và thuộc tính có invariant rõ

**Files:** Modify FE `pages/gis/network-editor/model.ts`/tests; Create `geometry-commands.ts`/tests để tách khỏi component; Modify workspace wiring. Extend GIS `UnitTests/NetworkEditValidationTests.cs`, `IntegrationTests/NetworkEditsPublishTests.cs`; Modify `Infrastructure/NetworkEditing/NetworkEditValidator.cs` chỉ nếu regression chứng minh gap.
**Interfaces:** `projectPointOnPipe(coordinates:Point[],point:Point):{point:Point,segment:number}` dùng local metric approximation consistent with existing 1m endpoint rule; `moveNode(state:State,edits:Edit[],id:string,point:Point):Edit[]`; `connectNodeToPipe(state:State,edits:Edit[],nodeId:string,pipeId:string,point:Point):Edit[]`. Split giữ original pipe target ID, tạo một node shared và một pipe mới; connect interior reuse selected existing node, không tạo node thứ hai. Operation IDs/references theo NetworkEditValidator aliases.

- [ ] **Step 1: Viết tests** `split_projects_pick_to_nearest_nonzero_segment`, `connect_reuses_existing_node_and_moves_attached_endpoints`, `split_hosted_device_requires_explicit_rehost`, `move_node_updates_offscreen_incident_pipes`, `invalid_material_diameter_host_blocks_submit`. Assertions: projected point nằm trên segment; from/to refs dùng đúng node ID; original stable ID giữ; no implicit connection khi line crosses; self-loop/foreign host rejected.
- [ ] **Step 2: Run** `npm --prefix water-network/water-network-fe/apps/gis run test:run -- src/pages/gis/network-editor/model.test.ts src/pages/gis/network-editor/geometry-commands.test.ts`. Expected: RED off-line split/connect chưa có.
Test projection thuần:
```ts
const projected = projectPointOnPipe([[105, 21], [105.01, 21]], [105.005, 21.001])
expect(projected.segment).toBe(0)
expect(projected.point[0]).toBeCloseTo(105.005, 6)
expect(projected.point[1]).toBe(21)
```

- [ ] **Step 3: Implement pure commands và UI actions.** Snap/project click trước split, endpoint pick không tạo pipe rỗng; closure Task 1 đầy đủ trước move/connect. Không tự đoán material/diameter của dữ liệu nguồn; defaults khi vẽ mới là suggestion được người dùng review và ghi rõ. Published asset code immutable như validator hiện hành; UI disable rename và giải thích ownership Asset.
- [ ] **Step 4: Chạy FE/GIS verifier.** Expected: GREEN; final graph validator kiểm tra batch không phụ thuộc thứ tự operations; existing atomic/race/idempotency tests vẫn xanh. Commit `fix(gis-editor): preserve network relations in geometry edits`.

## Task 4: Actor attribution, separation-of-duty và audit hồ sơ

**Files:** Create `water-network/water-network-be/docs/decisions/0028-shw-mvp-approval-and-recovery.md` (nếu số đã dùng chọn số trống kế tiếp, giữ link trong index); Modify Design `Domain/Aggregates/DesignRevision.cs`, `Application/Commands/CreateDesignRevisionCommandHandler.cs`, `ApproveDesignRevisionCommandHandler.cs`, `Infrastructure/Persistence/DesignRevisionPersistenceModel.cs`, `Configurations/DesignRevisionConfiguration.cs`, `Repositories/DesignRevisionRepository.cs`; additive EF migration `AddRevisionActorAttribution`; Modify network-edits GET DTO và FE model/API/workspace. Tests Design `UnitTests/NetworkEditRevisionTests.cs`, `IntegrationTests/DesignRevisionApprovalApiTests.cs`, `NetworkEditRevisionApiTests.cs`.
**Interfaces:** `DesignRevision.CreatedBy:string?` immutable; `Create(string projectId,string tenantId,int revisionNumber,string createdBy):DesignRevision` required for new production revisions; Reconstitute thêm `string? createdBy` sau existing optional networkEdits, repository truyền persisted value; `Approve(actorId,reason,correlationId)` rejects creator/latest submitter. GET editor revision adds `createdBy`, `transitions`, `validationResult`, preserving existing fields; transitions `{fromStatus,toStatus,actorId,reason,correlationId,occurredAt}`.

- [ ] **Step 1: Thêm tests** `Creator_Cannot_Approve_With_Both_Permissions`, `Submitter_Cannot_Approve_Another_Creators_Revision`, `Different_Reviewer_Can_Approve`, `Missing_Actor_Cannot_Create_Or_Approve`, `Legacy_Edit_Unknown_Creator_Fails_Closed`, `Revision_Audit_Reloads_Actor_Reason_And_Before_After`. Assertions: self approval 422 `SelfApprovalForbidden`; permission absent 403; foreign tenant 404; no approved event on reject; no invented creator in migration.
- [ ] **Step 2: Run** `dotnet test water-network/water-network-be/src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter FullyQualifiedName~DesignRevisionApprovalApiTests --nologo`. Expected: RED self-approval hiện chưa chặn.
- [ ] **Step 3: Implement attribution/domain checks + persistence/DTO.** Actor từ IRequestContext, không payload. Null historical creator policy như contract section; inventory pending revisions phải được ghi trong release report, không tự sửa DB/actor để unblock. Existing CAD fixture actors tách sender/reviewer để tests phản ánh separation, không hạ assertion.
- [ ] **Step 4: UI render creator/audit/before-after và validation warnings.** Capability+actor controls disable approve với giải thích; server vẫn enforce. Unknown historical revision giải thích cần revision thay thế, không nút “approve anyway”.
- [ ] **Step 5: Run Design/FE verifier và migration compatibility test** `Old_Revision_Reads_After_Actor_Migration`. Expected: GREEN; old GET fields còn; CAD published đọc được; commit `feat(design): enforce attributable separate network approval`.

## Task 5: Lifecycle expectedVersion và concurrency end-to-end

**Files:** Modify Design `Application/Commands/{ValidateRevisionCommand.cs,SubmitDesignRevisionCommand.cs,ApproveDesignRevisionCommand.cs,RejectDesignRevisionCommand.cs}` và handlers; Create Api `Endpoints/EditorRevisionActionsEndpointModule.cs`; Modify BFF NetworkEditorEndpointModule, FE api/workspace; extend Design Integration `NetworkEditRevisionApiTests.cs` và `ValidateRevisionTests.cs` unit tests.
**Interfaces:** Editor `POST /api/design/revisions/{id}/network-edits/{validate|submit|approve|reject}` body `{expectedVersion:int,reason?:string}`; BFF `/api/gis/editor/revisions/{id}/{action}` maps new routes. Commands nhận optional `ExpectedVersion` để legacy CAD routes compile/compatible; editor enforces required int >=0. Response là latest revision/validation payload, FE does not infer state solely from HTTP 200.

- [ ] **Step 1: Thêm tests** `Save_Validate_Race_Never_Submits_Stale_Validation`, `Stale_Action_Returns_409`, `Submitted_Draft_Mutations_Are_Locked`, `Reject_Requires_Reason_And_Revalidate`, `Real_Gis_Inspection_Blocks_Invalid_Submit`. Assertions: barrier race trên PostgreSQL CAS có tối đa một commit phù hợp; validation errors don't yield Submitted; mock-only IGisLookup không phải integration proof.
- [ ] **Step 2: Run** `dotnet test water-network/water-network-be/src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter FullyQualifiedName~NetworkEditRevisionApiTests --nologo`. Expected: RED stale action hiện không có request expectedVersion.
- [ ] **Step 3: Implement boundary/version checks và refetch.** Existing repository CAS là chốt cuối; fail save trước thì không tiếp tục submit. Wire real GIS API fixture (reuse PublishRoundTripTests host setup), kiểm tra changed targets tại validate/publish. UI warnings/errors focus operation, không ghi notice success khi isValid=false hoặc source unavailable.
- [ ] **Step 4: Run Design/BFF/FE verifier.** Expected: GREEN save/reload/validate/submit/approve/reject với separate fixture actors; API false-success/session regression xanh. Commit `fix(design): version editor lifecycle actions atomically`.

## Completion

- [ ] Draft lifecycle/geometry/ref dependencies/session/concurrency được kiểm chứng mới.
- [ ] Creator/submitter approval guard, audit reload và migration policy documented.
- [ ] CAD/import regression xanh; không tự chỉnh tài sản hoặc cấp quyền SHW.
- [ ] Checkbox và command/count evidence cập nhật trong plan này; **chưa claim MVP accepted**.

Tiếp tục `2026-10-03-shw-mvp-03-recovery-release.md`; editor chưa đủ release nếu chưa có publish recovery và restore drill.
