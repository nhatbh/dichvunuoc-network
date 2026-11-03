# SHW MVP 01 — Baseline và tra cứu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cán bộ SHW tra cứu toàn mạng, xem hồ sơ và lịch sử trên một baseline có thể tái tạo.
**Architecture:** Giữ GIS/Asset ownership, Design workflow và APISIX. Thêm tenant-scoped search vào GIS, public read contract vào BFF và dùng viewport loading hiện có cho canonical rich map; không tạo database BFF.
**Tech Stack:** .NET 10, PostgreSQL/PostGIS, EF Core/Dapper, SolidJS, TanStack Query, OpenLayers qua `@wn/map-runtime`, Vitest/Playwright.
**Spec:** `../specs/2026-10-03-shw-network-records-mvp-completion-design.md` — approved trong hội thoại ngày 2026-10-03.
**Status:** Approved — người dùng duyệt cả chương trình và chọn inline execution ngày 2026-10-03. Task 1 in progress; chưa có task implementation hoàn tất.

### Execution note — Task 1 prerequisites, 2026-10-03

- BASE: `e3e36f2f`; checkout hiện là `main`, chưa có worktree MVP. Chờ consent tạo worktree và sao chép WIP đúng scope; không implementation trên main.
- `dotnet --list-sdks` và `dotnet --version` từ root/BE: command not found; không thấy executable ở các vị trí local SDK thông dụng.
- Docker daemon reachable: `docker info --format '{{.ServerVersion}}'` → `29.8.0`; Node `v24.21.0`, npm `11.19.0`.
- GIS/contracts/map-runtime chưa có `node_modules`; chưa cài dependency, chưa chạy product test hoặc fixture.
- `git diff --check` đạt. Task 1 vẫn incomplete: chưa đạt workspace/SDK/baseline test gates. Không tick Step 2 chỉ vì đã chạy lệnh thất bại.
- Ledger riêng: `.superpowers/sdd/2026-10-03-shw-mvp-01-baseline-read/progress.md`; sẽ mang sang workspace được chọn cùng plan trạng thái.

## Global Constraints

- Tenant lấy từ verified Organization/session context. Không cho body/query chọn tenant thay cho phiên.
- Canonical geometry dùng EPSG:4326; CRS nguồn được chọn/xác nhận tại biên import.
- BFF là lớp proxy/read composition không database nghiệp vụ; FE chỉ gọi public BFF qua APISIX.
- Cross-tenant asset/revision/reference trả 404; thiếu quyền trong tenant trả 403; chưa đăng nhập trả 401.
- Fixture đọc ít nhất 10.000 assets; không yêu cầu tải full tenant trước khi tìm kiếm.
- Chạy .NET tests theo từng `.csproj`; exit 0 nhưng discover 0 là fail.
- Giữ nguyên WIP; không deploy, merge/push, đổi quyền hoặc mutate SHW mà không có approval phù hợp.
- Các đường dẫn dưới đây tương đối với **repo root `water-platform/`**, không phải CWD `water-network/`.

## Review Focus

1. Cursor bị sửa hoặc tái dùng sau khi đổi filter/tenant phải bị reject, không lặp/mất trang — Task 3.
2. Mã chứa `%`, `_`, dấu cách hoặc Unicode phải là input literal hợp lệ, không mở rộng SQL wildcard ngoài ý muốn — Task 3.
3. Asset JSON sai/null trong response 200 phải degrade rõ, không làm inspector crash — Task 4.
4. Pan nhanh rồi đổi Organization phải bỏ response cũ và clear selection — Task 5.
5. Asset bị xóa giữa search và detail phải báo not found; không giữ hồ sơ tài sản trước đó — Task 5.

## File map

`GIS` = `water-network/water-network-be/src/services/water-network-gis-be`; `Design` = service sibling `water-network-design-be`; `BFF` = sibling `water-network-bff`; `FE` = `water-network/water-network-fe/apps/gis/src`.
Trong Files: GIS Application/Infrastructure/Api/Contracts lần lượt là `GIS/src/WaterNetwork.Gis.<layer>/`; BFF Http/Endpoints là `BFF/src/WaterNetwork.Bff.Api/`; test `UnitTests|ContractTests|IntegrationTests/Foo.cs` là `<service>/tests/WaterNetwork.<Gis|Design|Bff>.<test-kind>/Foo.cs`. Tên migration là tên EF generate, file timestamp ghi vào evidence khi thực thi.

## Các lựa chọn triển khai

- SDK hiện pin `10.0.101` ở root và BE: giữ pin, xác minh availability/security trước khi đề xuất nâng; không lặp task “chốt SDK” của audit cũ khi đã có pin.
- Search mặc định `limit=100`, max `500`, `q` max 128 ký tự; types `node|pipe|device`; lifecycleStatus là projection nullable.
- Cursor v1 base64url JSON chứa normalized last code, kind, id và fingerprint filter/tenant; validate payload, không xem cursor là auth. Thứ tự `(upper(asset_code), kind, id)` với collation deterministic; SQL vẫn luôn có tenant/deleted filter.
- Search contains case-insensitive, escape wildcard; keyset có thể đổi khi asset code được cập nhật, không cam kết snapshot xuyên mutation. Thay filter phải reset cursor.
- Thêm exact APISIX `/api/gis/assets/*` đến canonical BFF với priority cao hơn legacy wildcard; không remove rollback routes.

## Task 1: Chốt inventory và kiểm chứng baseline, không làm lại WIP

**Files:** Create `water-network/water-network-be/docs/reports/2026-10-03-shw-mvp-baseline.md`; đọc spec, ba plan MVP, `global.json`, BE `global.json`, relevant workflows, editor/import/map source và migration files. Không stage secret `.env.vps`, deleted prototype hoặc WIP không liên quan.
**Interfaces:** Consumes Git source/WIP tại `b33b9104` và baseline BE `ed5d409e`; Produces inventory `path → commit/WIP → requirement → test/evidence → remaining gap`, build prerequisites và source/image mapping chưa xác minh phải ghi `unverified`.

- [ ] **Step 1: Chuẩn bị workspace được người dùng đồng ý.** Dùng using-git-worktrees; không implementation trên `main`. Nếu cần worktree mới, mang tracked patch + untracked files liên quan bằng bản sao đã kiểm kê; không stash/reset/clean checkout gốc. So sánh checksum và `git diff --check` trước/sau.
- [ ] **Step 2: Xác minh toolchain.** Run `dotnet --list-sdks`, `dotnet --version` từ root và BE, `docker info`, `node --version`. Expected: đúng hai pin hiện hành; Docker dùng fixture riêng. Thiếu tool/dependency → prerequisite chưa đạt, không tick gate.
- [ ] **Step 3: Chạy baseline từng project.** GIS/Design: `dotnet test water-network/water-network-be/src/services/<service>/tests/<project>/<project>.csproj --nologo --logger trx` cho Unit/Contract/Integration; BFF cho Unit/Integration; legacy cho `water-network/water-network-fe/water-network-gis-bff/WaterNetwork.GisBff.Tests/WaterNetwork.GisBff.Tests.csproj`. Expected: mỗi project count > 0; ghi failure có sẵn, không sửa ngoài scope.
- [ ] **Step 4: Chuẩn bị FE bằng lockfile trong workspace.** `npm --prefix water-network/water-network-fe/packages/contracts ci && npm --prefix water-network/water-network-fe/packages/contracts run build`; tương tự map-runtime, rồi GIS `ci`. Run GIS `typecheck`, `lint`, `test:run`, `build`, `size`. Expected: không nâng dependency ngoài scope; lint 0 error, ≤ budget 180 hiện hành và không tăng so baseline thực đo; ghi counts/warnings.
- [ ] **Step 5: Ghi inventory và phạm vi WIP vào report.** Source tests không xác minh image production; không dùng old plan tick thay evidence. Run `git diff --check`. Expected: report phân biệt source/verified/merged/deployed/smoke/accepted. Commit riêng `docs(network): record SHW MVP baseline and gaps`.

Task này là verification/documentation, không thêm product behavior nên không yêu cầu tạo test RED giả.

## Task 2: Làm test discovery và SDK gate tái sử dụng được

**Files:** Create `water-network/water-network-be/scripts/shw-mvp/assert_trx.py`, `test_assert_trx.py`, `verify.sh`; Modify `.github/workflows/_water-network-dotnet-service.yml`, `_dotnet-service.yml` chỉ phần GIS legacy/canonical cần thiết; cập nhật report Task 1. Giữ workflow WIP hiện có, không rewrite fleet CI.
**Interfaces:** `assert_trx(path: Path) -> int` trả count passed, raise `ValueError` nếu missing/0/fail; CLI exit nonzero cho lỗi. `verify.sh --suite gis|design|bff|legacy|fe|all` chạy từng project và assert mọi TRX. Produces command dùng xuyên các plan.

- [ ] **Step 1: Viết tests stdlib unittest** `zero_total_rejected`, `failed_test_rejected`, `missing_counters_rejected`, `positive_passed_count_accepted` và fixture có XML namespace. Assertions: 0/missing/fail raise `ValueError`; fixture total=3 passed=3 returns 3.
Assertions tối thiểu trong unittest:
```python
with self.assertRaises(ValueError):
    assert_trx(zero_total_fixture)
self.assertEqual(assert_trx(three_passed_fixture), 3)
```
Hai fixture là file TRX tạm do test tạo (namespace Microsoft TRX, counters total/passed/failed), không lấy kết quả từ log cũ.

- [ ] **Step 2: Run** `python3 -m unittest discover -s water-network/water-network-be/scripts/shw-mvp -p 'test_*.py'`. Expected: RED vì helper chưa tồn tại.
- [ ] **Step 3: Implement helper và verifier.** Resolve root từ vị trí script, verify SDK theo `global.json`, explicit project list như Task 1, unique TRX results directory, không dùng `.slnx` làm test gate. FE suite chạy contracts/map-runtime tests + GIS typecheck/lint/tests/build/size. Kết quả lưu dưới artifact directory được cung cấp qua `SHW_MVP_ARTIFACT_DIR`; nếu thiếu dùng directory git-ignored workspace, không tự commit logs.
- [ ] **Step 4: Wire CI discovery assertion vào workflows hiện có.** Restore audit warnings-as-errors cho legacy và canonical; không pin SDK khác với source. Nếu dependency advisory thật còn tồn tại, thêm regression restore case và remediate đúng package/service; không nâng root fleet package bằng suy đoán.
- [ ] **Step 5: Run unittest rồi `bash water-network/water-network-be/scripts/shw-mvp/verify.sh --suite all`.** Expected: unit GREEN, từng suite count > 0, SDK match, .NET 0 warning; FE budget không tăng. Commit `ci(network): enforce SHW MVP SDK and nonzero test discovery`.

## Task 3: GIS search toàn tenant và cursor ổn định

**Files:** Create dưới GIS `src/WaterNetwork.Gis.Application/{Queries/SearchAssetsQuery.cs,Queries/SearchAssetsQueryHandler.cs,Ports/IAssetSearchReadDao.cs,Dtos/AssetSearchPageDto.cs}`, Infrastructure `Repositories/AssetSearchReadDao.cs`, `Queries/AssetSearchCursor.cs`; Modify GIS Api `Endpoints/AssetsEndpointModule.cs`, `Program.cs`; Create GIS tests `UnitTests/SearchAssetsTests.cs`, `IntegrationTests/SearchAssetsApiTests.cs`, `ContractTests/AssetSearchContractTests.cs` (tất cả dưới service test folder hiện có). Migration/index dưới GIS Infrastructure `Persistence/Migrations/` được EF generate với tên `AddAssetSearchIndexes`, không viết designer tay.
**Interfaces:** `SearchAssetsQuery(string? Q, string? Type, string? LifecycleStatus, string? Cursor, int Limit=100) : IQuery<AssetSearchPageDto>`; `IAssetSearchReadDao.QueryAsync(string tenantId, SearchAssetsQuery query, int take, CancellationToken ct) : Task<IReadOnlyList<AssetSearchItemDto>>`; `AssetSearchItemDto(string Id,string Kind,string AssetCode,string? LifecycleStatus,JsonNode Geometry)`; `AssetSearchPageDto(IReadOnlyList<AssetSearchItemDto> Items,string? NextCursor)`. GIS route `GET /api/network/assets/search` permission `network-gis:read`.

- [ ] **Step 1: Viết tests** `Search_Finds_Asset_Outside_Map_Extent`, `Cursor_Pages_Same_Code_Across_Kinds_Without_Duplicate`, `Search_Is_Tenant_Scoped`, `Invalid_Cursor_And_Filter_Mismatch_Return_400`, `Wildcard_Is_Literal`, `Limit_Cap_And_Deleted_Filter`. Seed hai tenants và mã trùng giữa kinds. Assertions: search finds outside asset; union tất cả pages bằng seeded IDs, distinct count bằng total; tenant B IDs absent; invalid cursor/limit>500 → 400; `%` không match mọi asset.
Assertion HTTP sau khi setup authenticated tenant fixture bằng `GisApiFactory`/DevJwtTokenFactory hiện có:
```csharp
var response = await client.GetAsync("/api/network/assets/search?limit=501");
response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
```
Happy/cursor cases deserialize `AssetSearchPageDto` và so seeded IDs, không chỉ assert HTTP200.

- [ ] **Step 2: Run** `dotnet test water-network/water-network-be/src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter FullyQualifiedName~SearchAssetsApiTests --nologo`. Expected: RED route/contract chưa có.
- [ ] **Step 3: Implement query validation/cursor/DAO và register endpoint.** Dapper parameterized UNION ALL 3 tables + asset-state projection; `limit+1` và stable seek tuple. Index theo normalized code/tenant/deleted predicate, contains dùng pg_trgm chỉ nếu extension/deployment support được xác minh trong fixture; không giả định index sẽ được planner chọn. Ghi EXPLAIN/query time trên fixture 10.000 và migration compatibility.
- [ ] **Step 4: Run verifier `--suite gis`.** Expected: GREEN, tests > 0; SQL tenant predicates cả 3 branches; số đo/index evidence lưu report, chưa tự gán p95 SLO. Commit `feat(gis): add tenant-scoped asset search with stable cursors`.

## Task 4: BFF public search, overview và geometry history

**Files:** Modify BFF `Http/IGisApiClient.cs`, `GisApiClient.cs`, `AssetApiClient.cs`, `AuthForwardingHandler.cs`, `Endpoints/OverviewEndpointModule.cs`, `Program.cs`; Create BFF `Endpoints/AssetReadEndpointModule.cs`, tests `IntegrationTests/AssetReadEndpointTests.cs`; Modify GIS `Application/Queries/GetNodeGeometryHistoryQueryHandler.cs` khi tách logic shared; Create GIS `Application/Queries/GetAssetGeometryHistoryQuery.cs`/handler; Modify GIS Api Nodes/Pipes/Devices endpoints. Modify `platform-core/deploy/core/apisix/configmap.yaml` và `deploy/k3s/water-network-core/gateway/` route verifier đúng ownership, không overwrite unrelated IAM WIP.
**Interfaces:** `IGisApiClient.GetSearchAsync(string? q,string? type,string? lifecycleStatus,string? cursor,int? limit,CancellationToken ct)` và `GetGeometryHistoryAsync(string type,string id,CancellationToken ct)` trả `Task<MapPassthrough>`. Public `GET /api/gis/assets/search`, `GET /api/gis/assets/{id}?type=node|pipe|device`, `GET /api/gis/assets/{id}/geometry-history?type=...`; overview giữ `{assetId,type,gis,lifecycle,sources}` hiện có, route cũ còn hoạt động. History `{supported:true,items:[GeometryVersionDto]}` với tenant existence gate trước DAO không có tenant column.

- [ ] **Step 1: Thêm tests** `Search_Forwards_Encoded_Cursor_And_Filters`, `Overview_Asset_Down_Degrades`, `Malformed_200_Becomes_502`, `History_Foreign_Or_Deleted_Id_Is_404`, `Exact_Assets_Route_Wins_Legacy_Wildcard`. Assertions: query round-trips nguyên giá trị; GIS 404 → 404; GIS 5xx/bad JSON/null → 502; Asset down → lifecycle null + source unavailable; bearer/correlation/trace được forward.
- [ ] **Step 2: Run** `dotnet test water-network/water-network-be/src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj --filter FullyQualifiedName~AssetReadEndpointTests --nologo`. Expected: RED public routes chưa có.
- [ ] **Step 3: Implement public routes và reuse overview fan-out.** `network-gis:read` permission cho public read, giữ route cũ. Catch malformed JSON ở detail/Asset clients như map passthrough. AuthForwardingHandler lấy tenant từ verified `ITenantContextAccessor` trong inbound request scope, không forward raw X-Tenant-Id có thể override context; generated correlation khi caller thiếu; HttpClient Activity propagation giữ W3C trace. Thêm `Spoofed_Tenant_Header_Cannot_Change_Downstream_Tenant` và `Generated_Correlation_And_Trace_Are_Forwarded` vào tests. History node/pipe/device reuse geometry_versions và kiểm tra tenant/kind; mọi type có API rõ, empty history không giả là unsupported. Không trả history tài sản đã soft-delete qua public inspector.
- [ ] **Step 4: Register exact asset routes trong APISIX source + render tests.** Không deploy gateway. Run GIS/BFF verifier và `bash deploy/k3s/water-network-core/verify.sh --render`. Expected: GREEN; exact route priority thắng wildcard, upstream canonical BFF. Commit `feat(bff): expose canonical asset search profiles and history`.

## Task 5: Canonical rich map, search/list/inspector không phụ thuộc full dataset

**Files:** Modify GIS FE `pages/gis/gis-app.tsx`, `gis-home.tsx`, `map-page.tsx`, `screens/assets.tsx`, `entities/gis/queries.ts`, `widgets/asset-inspector/asset-inspector.tsx`; Create `pages/gis/screens/canonical-map.tsx`, `canonical-assets.tsx`, `entities/gis/asset-queries.ts`, `widgets/asset-inspector/asset-profile.tsx` và adjacent tests. Legacy screens/data adapter giữ nguyên. Reuse `pages/gis/lib/viewport-bbox.ts`; không rebuild map engine.
**Interfaces:** TS `searchAssets({q,type,lifecycleStatus,cursor,limit}, signal): Promise<AssetSearchPage>` contract Task 3; `assetOverview(id,type,signal)` và `assetHistory(id,type,signal)` contracts Task 4. `CanonicalMapScreen` render trong shell hiện có, không lồng AppShell thứ hai; viewport controller tách từ `TenantMapViewer`, giữ getView/buffer/late-response checks. `CanonicalAssetsScreen` dùng cùng search API và Next page/virtual list, không dùng G.P/G.N full snapshot.

- [ ] **Step 1: Viết UI tests** `search_outside_viewport_flys_to_asset`, `list_reaches_row_201_and_final_10000`, `late_bbox_response_cannot_repaint`, `organization_change_clears_selection_and_queries`, `deleted_search_result_does_not_keep_old_profile`, `asset_source_failure_is_visible`, `canonical_entry_does_not_fetch_initial_full_extent`, `dashboard_counts_use_bootstrap_not_viewport`. Mock BFF contracts Task 4, không mock full G dataset; assert request có cursor và không gọi `/editor/assets` không query hoặc `/full`.
- [ ] **Step 2: Run** `npm --prefix water-network/water-network-fe/apps/gis run test:run -- src/pages/gis/screens/canonical-map.test.tsx src/pages/gis/screens/canonical-assets.test.tsx src/widgets/asset-inspector/asset-profile.test.tsx`. Expected: RED chưa có component/data path.
- [ ] **Step 3: Wire canonical branch riêng trong GisApp.** GisHome phải bỏ initial networkQuery như điều kiện ready/provider: bootstrap cung cấp summary/home view, provider dùng canonical metadata và empty feature collections cho shell; map/assets không gọi initial full extent chỉ để mount. Dashboard counts lấy bootstrap, không tính lại từ empty/loaded viewport. Reuse viewport controller, preserve basemap/layer visibility/measure khi refetch. Session scope vào query keys và AbortSignal; UI có zoom-in khi truncated, loaded/tenant counts rõ. Search chọn asset → overview geometry → fit bbox → map refetch → inspector; deleted asset clear selection. Assets list reset cursor khi đổi filter/scope. Giữ legacy rollback branch và import/editor hash routing WIP.
- [ ] **Step 4: Run `verify.sh --suite fe`.** Expected: GREEN, 0 lint error/budget không tăng, typecheck/build/size đạt; thêm regression legacy/canonical runtime branch không cross-call data sources.
- [ ] **Step 5: Ghi benchmark fixture 10.000 assets và request inventory.** Expected: map/search/list không tải full tenant, browser memory/bytes/latency có số đo; không gọi benchmark này là production SLO. Commit `feat(gis-ui): complete canonical asset lookup and profiles`.

## Completion và handoff

- [ ] Baseline report và commands/counts mới có evidence; source/image mapping thiếu vẫn ghi unverified.
- [ ] Search/map/list/profile/history có tenant/failure tests và fixture ≥10.000.
- [ ] Migration + APISIX render xanh; **chưa deploy, chưa chấp nhận SHW, chưa retire legacy**.
- [ ] Cập nhật checkbox chính plan này và report; self/fresh review theo executor.

Sau khi plan này verified, tiếp tục `2026-10-03-shw-mvp-02-editor-approval.md` theo approval thực thi đã chọn; không tự mở OBS/HYD/CIM.
