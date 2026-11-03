# DSN-2 Draft Assets + Validate (US-P2-03, US-P2-04) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-design-be` (Phase 2, slice DSN-2)
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §7 (slice DSN-2)
**Phụ thuộc:** DSN-1 (DesignProject + DesignDocument đã ship, DB `wn_design`, outbox publish-only).

## Bản chất

DSN-2 biến design-be từ "kho tài liệu" (DSN-1) thành **staging area có draft + validate** — hiện thực
hóa nguyên tắc roadmap §7.1 "dữ liệu chưa đáng tin chưa được vào bản đồ". Kết thúc DSN-2: một
`DesignRevision` chứa các `DraftNetworkAsset` có thể chạy `ValidateRevision` → chuyển `Draft→Validated`,
sẵn cho DSN-3 (submit/approve) và DSN-4 (publish→GIS).

**Ngoài scope (DSN sau):** submit/approve/reject revision (DSN-3); publish→GIS qua event (DSN-4);
parse file PDF/DWG/CAD thành draft (DSN sau — file vẫn chỉ là tài liệu đính kèm của DSN-1).

## Scope (DSN-2)

1. `DesignRevision` aggregate + state machine `Draft → Validated` + `CreateDesignRevisionCommand`.
2. `DraftNetworkAsset` (Node/Pipe/Device) + `CreateDraftAssetCommand` (single) +
   `CreateDraftAssetsBatchCommand` (batch, resolve `clientRef`) + `UpdateDraftGeometryCommand`.
3. `ValidateRevisionCommand` + `IDraftValidationService` (engine) → `ValidationResult` machine-readable
   lưu trên revision; 0 error → `Validated`.
4. Preview query (US-P2-03) + revision detail query.
5. Bật **PostGIS + NetTopologySuite** lần đầu ở design-be (DSN-1 deferred theo decision DSN-1 #3).
6. `IGisLookupPort` (Application) + mock adapter — check trùng asset code với GIS hiện có.
7. Events `design.revision.created`, `design.revision.validated` (outbox, publish-only, thin).

## Quyết định chốt (đã brainstorm với user — 2026-06-16)

| # | Quyết định | Chọn | Ghi chú |
|---|---|---|---|
| 1 | Revision ↔ Project | **Nhiều revision/project, tạo qua `CreateDesignRevisionCommand`** | Mỗi revision là 1 lô draft độc lập đi qua state machine. Linh hoạt cho nhiều đợt thiết kế/import. |
| 2 | Lưu/validate geometry | **Cột PostGIS thật + NTS** (giống gis-be) | Bật PostGIS extension + `UseNetTopologySuite()`; validate `IsValid` trong Application. Sẵn cho DSN-4. |
| 3 | GIS cross-check | **Có `IGisLookupPort` + mock adapter ngay DSN-2** | Duplicate check gồm in-batch + check code đã tồn tại bên GIS. Real HTTP adapter swap sau. |
| 4 | Create mode | **Cả single + batch** | Single hợp vẽ tay UI; batch hợp import dataset (resolve clientRef trong batch). |
| 5 | Events draft create | **Không phát** (thin) | Draft asset nội bộ + high-churn; chỉ phát revision-level event. Follow-up nếu sau cần. |
| 6 | GiST index trên draft geometry | **Không** | Chỉ validate, không spatial query trên draft. Index thường `(tenant_id, revision_id)` + `(revision_id, asset_code)`. |
| 7 | Batch partial fail | **Request-level all-or-nothing** | 1 phần tử sai schema → 400, không tạo gì. Lỗi *nghiệp vụ* cross-ref để dành ValidateRevision (không chặn create). |

## Domain model

### `DesignRevision` (Aggregate Root mới)

| Field | Ghi chú |
|---|---|
| `id` | UUIDv7 (decision 0012/uuid-v7) |
| `projectId` | FK → `design_projects.id` |
| `tenantId` | multi-tenancy |
| `revisionNumber` | int, tăng dần trong project (1,2,3…); unique `(tenant_id, project_id, revision_number)` |
| `status` | `Draft` / `Validated` (enum VO `DesignRevisionStatus`) |
| `validationResult` | jsonb, null khi chưa validate |
| `createdAt`, `updatedAt`, `version` | base `AggregateRoot` |

State machine DSN-2:

```text
Draft ──ValidateRevision (0 blocking error)──► Validated
  ▲                                              │
  └──────── ValidateRevision (có error) ◄────────┘
```

- Validate lại khi đã `Validated` mà phát sinh error → quay về `Draft` (validationResult cập nhật).
- `Submitted`/`Approved`/`Rejected`/`Published` thêm ở DSN-3/DSN-4 (ngoài scope).
- Domain events: `DesignRevisionCreated`, `DesignRevisionValidated`.

### `DraftNetworkAsset` (entity thuộc revision — không phải AR riêng)

Sống/chết theo revision (cascade). Không có aggregate boundary riêng vì luôn truy cập qua revision.

| Field | Ghi chú |
|---|---|
| `id` | UUIDv7 |
| `revisionId` | FK → `design_revisions.id` |
| `tenantId` | multi-tenancy |
| `draftKind` | `Node` / `Pipe` / `Device` (VO `DraftAssetKind`) |
| `assetCode` | string (validate duplicate ở ValidateRevision, không unique constraint cứng — draft cho phép tạm trùng tới khi validate) |
| `clientRef` | string nullable — để pipe tham chiếu node trong cùng revision khi node chưa có id thật (import dataset) |
| `geometry` | PostGIS 4326: `Point` cho Node/Device, `LineString` cho Pipe |
| `attributes` | jsonb — attrs theo kind (vd pipe: diameterMm/material; device: deviceType/hostKind) |
| `fromRef`, `toRef` | string nullable (Pipe) — chứa `clientRef` hoặc `draftId` của node endpoint |
| `hostRef` | string nullable (Device) — `clientRef`/`draftId` của host node/pipe |
| `createdAt`, `updatedAt` | audit |

## Validation engine (Application — `IDraftValidationService`)

Chạy trên toàn bộ draft của một revision; sinh `ValidationResult { errors[], warnings[] }`
machine-readable. Mỗi item: `{ code, draftAssetId?, clientRef?, field?, message }`.

| Rule | Mức | Nguồn |
|---|---|---|
| Duplicate asset code trong revision | **error** (`DuplicateAssetCode`) | group by `assetCode`, count > 1 |
| Asset code đã tồn tại bên GIS | **error** (`AssetCodeExistsInGis`) | `IGisLookupPort.AssetCodeExists` (mock) |
| Pipe `from/toRef` không resolve được tới draft node trong revision | **error** (`PipeEndpointMissing`) | US-P2-03 |
| Geometry invalid (NTS `IsValid`; Pipe LineString ≥ 2 điểm phân biệt; Node/Device Point) | **error** (`InvalidGeometry`) | NTS |
| Thiếu attrs bắt buộc theo kind | **error** (`MissingRequiredAttribute`) | mirror bất biến gis-be |
| Thiếu attrs optional | **warning** (`MissingOptionalAttribute`) | — |

Attrs bắt buộc theo kind (mirror bất biến gis-be):
- **Node:** `nodeType`.
- **Pipe:** `fromRef`, `toRef`, `diameterMm > 0`, `material`.
- **Device:** `deviceType`; host rule theo deviceType — `Valve`/`FlowMeter` cần host Pipe; `PressureSensor`
  cần host Pipe hoặc Node; `Pump`/`Hydrant` cần host Node.

Kết quả lưu vào `revision.validationResult` (jsonb). 0 error → `status = Validated`; có error → `Draft`.

## API & contract (route `/api/design/...`)

| Endpoint | Command/Query | Permission |
|---|---|---|
| `POST /api/design/projects/{projectId}/revisions` | `CreateDesignRevisionCommand` → 201 `{id, revisionNumber}` | `network-design:write` |
| `POST /api/design/revisions/{revisionId}/draft-assets` | `CreateDraftAssetCommand` (single) → 201 `{id}` | `network-design:write` |
| `POST /api/design/revisions/{revisionId}/draft-assets:batch` | `CreateDraftAssetsBatchCommand` (array) → 201 `{ids[]}` | `network-design:write` |
| `PATCH /api/design/draft-assets/{id}/geometry` | `UpdateDraftGeometryCommand` → 200 | `network-design:write` |
| `POST /api/design/revisions/{revisionId}/validate` | `ValidateRevisionCommand` → 200 `ValidationResultDto` + status | `network-design:write` |
| `GET /api/design/revisions/{revisionId}` | `GetDesignRevisionDetailQuery` → detail + status + validationResult (404 nếu thiếu/khác tenant) | `network-design:read` |
| `GET /api/design/revisions/{revisionId}/preview` | `GetRevisionPreviewQuery` → danh sách draft assets (US-P2-03) | `network-design:read` |

Quy ước input geometry: GeoJSON-shaped trong request body (parse → NTS Geometry tại boundary), nhất
quán với cách FE gửi lên gis-be.

## Data model (DB `wn_design`)

```sql
-- Bật PostGIS lần đầu cho wn_design (migration M-DSN2-1)
create extension if not exists postgis;

-- design_revisions
create table design_revisions (
  id uuid primary key, project_id uuid not null, tenant_id text not null,
  revision_number int not null,
  status text not null default 'Draft',
  validation_result jsonb null,
  created_at timestamptz, updated_at timestamptz, row_version bytea,
  unique (tenant_id, project_id, revision_number));
create index ix_design_revisions_project on design_revisions (tenant_id, project_id);

-- draft_network_assets (geometry PostGIS, KHÔNG GiST — chỉ validate)
create table draft_network_assets (
  id uuid primary key, revision_id uuid not null, tenant_id text not null,
  draft_kind text not null, asset_code text not null, client_ref text null,
  geometry geometry(Geometry, 4326) not null,
  attributes jsonb not null default '{}',
  from_ref text null, to_ref text null, host_ref text null,
  created_at timestamptz, updated_at timestamptz);
create index ix_draft_assets_revision on draft_network_assets (tenant_id, revision_id);
create index ix_draft_assets_code on draft_network_assets (revision_id, asset_code);
```

- `UseNetTopologySuite()` trên `DesignDbContext` (Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite
  đã có trong `Directory.Packages.props`).
- EF global query filter theo tenant cho cả 2 bảng mới.
- Cột `geometry(Geometry, 4326)` (generic geometry — chứa cả Point lẫn LineString); ràng buộc kind ↔
  geometry type kiểm ở Domain/validate, không ở cột.
- FK `draft_network_assets.revision_id` → `design_revisions.id` (cascade delete). FK
  `design_revisions.project_id` → `design_projects.id` (index; FK cứng theo pattern DSN-1 — DSN-1 chỉ
  index project_id cho documents, ở đây thêm FK thật vì revision có vòng đời gắn project).

## Events (qua outbox, publish-only — thin)

| Event | Version | Payload |
|---|---|---|
| `design.revision.created` | v1 | `{revisionId, projectId, tenantId, revisionNumber, occurredAt}` |
| `design.revision.validated` | v1 | `{revisionId, projectId, tenantId, errorCount, warningCount, isValid, occurredAt}` |

- Đăng ký qua `AddOutboxDomainEventTypesFromAssembly` + extend `DesignIntegrationEventMapper` (pattern DSN-1).
- Draft asset create/update/geometry **không** phát event (nội bộ + high-churn) — quyết định #5.

## Ports mới

- **`IGisLookupPort`** (Application): `Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct)`.
- **Adapter mock** (`StubGisLookupAdapter`, Infrastructure): trả `false` mặc định; cấu hình seed list
  code "đã tồn tại" cho test. Config flag `GisLookup:Provider` (mirror `FileStorage:Provider` của DSN-1).
- **Real adapter sau** (`HttpGisLookupAdapter` → gọi gis-be API): chỉ thêm adapter + đổi config, không
  đụng Domain/Application (ghi follow-up).

## Bảng xử lý lỗi

| Tình huống | Kết quả |
|---|---|
| Create revision: project không tồn tại / khác tenant | 404 |
| Create draft asset: revision không tồn tại / khác tenant | 404 |
| Create draft asset: thiếu field bắt buộc của request / geometry parse fail | 400 (validation) |
| Batch: 1 phần tử sai schema | 400, không tạo phần tử nào (all-or-nothing request-level) |
| Update geometry: draft asset không tồn tại / khác tenant | 404 |
| Update geometry: geometry parse fail / sai type theo kind | 400 |
| Validate: revision không tồn tại / khác tenant | 404 |
| Validate thành công không error | 200, status `Validated`, validationResult.errors = [] |
| Validate có error | 200, status `Draft`, validationResult.errors[] machine-readable |
| Thiếu permission | 403 |
| Không token | 401 |

Lưu ý: ValidateRevision trả **200** kể cả khi có error nghiệp vụ — validation result là *payload nghiệp
vụ*, không phải lỗi HTTP. 4xx chỉ cho lỗi request/không tìm thấy/quyền.

## Test (TDD)

- **Unit (Domain + Application):**
  - `DesignRevision` state machine: Create → Draft; Validate 0 error → Validated; Validate có error →
    Draft; re-validate Validated→Draft khi mới phát sinh error.
  - `IDraftValidationService` matrix: mỗi rule sinh đúng error/warning code; duplicate in-revision;
    pipe endpoint không resolve; geometry NTS invalid; required attr thiếu; optional attr thiếu (warning).
  - Host-rule matrix theo deviceType (5 loại × có/thiếu host đúng kind).
  - clientRef resolve trong batch (pipe ref node cùng batch qua clientRef; ref draftId thật).
  - `CreateDesignRevisionCommandHandler`: revisionNumber tăng dần per project.
- **Integration** (`PostgisFixture` — DSN-2 cần PostGIS thật; `Jwt:Mode=Mock`, `EventBus:Transport=InMemory`):
  - Create revision → 201 (revisionNumber=1; revision thứ 2 → 2).
  - Create draft single + batch → 201; row trong `draft_network_assets`; geometry round-trip đúng.
  - Validate happy (drafts hợp lệ, GIS mock trả false) → Validated, errors=[].
  - Validate từng loại error → Draft + validationResult chứa đúng code.
  - GIS duplicate (mock seed code) → error `AssetCodeExistsInGis`.
  - Tenant A không truy cập revision/draft của tenant B → 404.
  - Event `design.revision.created` + `design.revision.validated` trong outbox.
- **Contract:** schema/round-trip 2 event mới publisher-side (pattern DSN-1 ContractTests).

## Package mới

Không. `NetTopologySuite` + `Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite` đã có trong
`Directory.Packages.props`; chỉ thêm `PackageReference` vào `WaterNetwork.Design.Infrastructure`
(+ Domain/Application nếu cần kiểu `Geometry`).

## Ngoài scope (ghi follow-up)

- Submit/Approve/Reject revision + `network-design:approve` permission + audit transition (DSN-3).
- Publish→GIS (`design.asset.ready-for-gis` + consumer GIS) (DSN-4).
- Parse file PDF/DWG/CAD/GeoJSON thành draft asset (DSN sau).
- Real `HttpGisLookupAdapter` → gis-be API (mock Phase 2).
- Event cho draft asset create/update nếu downstream cần (hiện thin).
- Delete/remove draft asset; clone revision; diff giữa 2 revision.
- GiST index trên draft geometry nếu sau cần spatial preview query.

## Definition of Done

- `dotnet test` xanh 0 warning trên solution design (unit + integration + contract).
- 7 endpoint đúng bảng xử lý lỗi; 2 event publish qua outbox; tenant isolation.
- PostGIS extension + NTS bật cho `wn_design`; migration mới chạy được.
- Conventional commit; checkbox plan tick đủ; roadmap §3.3 tick DSN-2.
