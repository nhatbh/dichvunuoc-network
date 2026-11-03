# DSN-1 Design Project + Document (US-P2-01, US-P2-02) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-design-be` (service mới — slice đầu Phase 2)
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §7 (slice DSN-1)
**Phụ thuộc:** không (slice mở đầu design-be). Building blocks + pattern scaffold (gis-be/asset-be) đã có.

## Bản chất

Design service là **staging area có quy trình phê duyệt** — "dữ liệu chưa đáng tin chưa được vào bản đồ"
(roadmap §7.1). Tách khỏi GIS vì draft có vòng đời/quyền khác dữ liệu chính thức, GIS không parse
PDF/DWG, và khối lượng draft không được ảnh hưởng map query.

DSN-1 chỉ làm **hai khối nền** của service: tạo `DesignProject` và upload `DesignDocument`. State
machine (`DesignRevision`), `DraftNetworkAsset`, validation engine, publish→GIS đều thuộc **DSN-2+**
(ngoài scope).

## Scope (DSN-1)

1. Scaffold `water-network-design-be` full layered (Domain/Application/Infrastructure/Api/Contracts +
   Unit/Integration/Contract tests), DB `wn_design`, outbox, event bus (publish-only — chưa consume).
2. `CreateDesignProject` (US-P2-01) + `GetDesignProjectDetail` + event `design.project.created`.
3. `UploadDesignDocument` (US-P2-02) qua `IFileStoragePort` + mock adapter LocalDisk + config
   `FileStorage:Provider`; store-file-then-commit-metadata; size/type policy; event
   `design.document.uploaded`.

## Quyết định chốt (đã brainstorm với user — 2026-06-15)

| # | Quyết định | Chọn | Ghi chú |
|---|---|---|---|
| 1 | File storage | `IFileStoragePort` + mock `LocalDiskFileStorageAdapter` (chạy được, lưu đĩa) | Decision #12: external service mock qua port; real `HttpFileStorageAdapter`→platform-core/file-storage-be (presigned) swap sau, không đổi Domain/Application |
| 2 | Upload mechanism | **multipart/form-data** (IFormFile + form fields) | Chuẩn HTTP cho file, hợp PDF/DWG lớn (vs base64 phình 33%) |
| 3 | PostGIS / NTS | **Defer sang DSN-2** | DSN-1 Postgres thường, 2 bảng phẳng; PostGIS extension + `UseNetTopologySuite()` + `draft_network_assets` thêm ở DSN-2 |
| 4 | DesignDocument boundary | Entity/bảng riêng FK `projectId`, ghi qua command riêng | Không load cả project (+ toàn bộ docs) chỉ để thêm 1 doc |
| 5 | Project status | Field `Open/Cancelled`, DSN-1 chỉ tạo `Open` | Lệnh Cancel defer (US không yêu cầu ở DSN-1) |
| 6 | Download / list | Không có ở DSN-1 | Port chỉ `SaveAsync`; query chỉ detail (US-P2-01 yêu cầu detail) |

## Service scaffold

Theo `docs/conventions/template-mapping.md` + pattern asset-be. Building blocks dùng: `AddPlatformCqrs`
+ behaviors, `AddPlatformPersistence<DesignDbContext>`, `AddPlatformOutbox`,
`AddPlatformEventBus` (chỉ publish), `AddOutboxDomainEventTypesFromAssembly`, `AddPlatformWebApi`,
`AddDefaultHealthChecks`, MultiTenancy (EF global query filter theo tenant). Dockerfile (mirror
asset-be) + docker-compose service `water-network-design-be` port **8084** (gis 8081 / asset 8082 /
bff 8083). DB `wn_design`.

## File storage (chốt #1, #2)

- **`IFileStoragePort`** (Application):
  `Task<string> SaveAsync(string fileName, string contentType, Stream content, CancellationToken ct)`
  → trả `fileRef` (key/path tương đối). DSN-1 chỉ cần `SaveAsync`.
- **`LocalDiskFileStorageAdapter`** (Infrastructure): lưu file vào
  `FileStorage:LocalDisk:RootPath`/`{guid}/{fileName}`, trả ref tương đối. Tạo thư mục nếu chưa có.
- Config: `FileStorage:Provider=LocalDisk`, `FileStorage:LocalDisk:RootPath`,
  `FileStorage:MaxSizeBytes`, `FileStorage:AllowedContentTypes` (allowlist).
- **Real adapter sau** (`HttpFileStorageAdapter` → file-storage-be presigned): chỉ thêm adapter +
  đổi `FileStorage:Provider` — không đụng Domain/Application (ghi follow-up).

## Domain model & DB (chốt #3, #4, #5)

- **`DesignProject`** (Aggregate Root): `id` (UUID v7 — decision 0012/uuid-v7), `tenantId`,
  `name` (bắt buộc), `branchId?`, `zoneId?` (string optional, không FK — zone-be chưa có), `status`
  (`Open`/`Cancelled`; tạo = `Open`), `createdAt`, `updatedAt`. Domain event `DesignProjectCreated`.
- **`DesignDocument`** (entity/bảng riêng): `id`, `projectId` (FK), `tenantId`, `fileName`,
  `contentType`, `sizeBytes`, `fileRef`, `documentType` (`PDF/DWG/DXF/GeoJSON/Other`), `uploadedBy`,
  `uploadedAt`. Domain event `DesignDocumentUploaded`.
- DB `wn_design`: `design_projects`, `design_documents` (Postgres thường, **không geometry**). Unique
  nghiệp vụ: `(tenant_id, name)` cho project (theo nguyên tắc multi-tenancy roadmap §2.3) — *chốt: có*,
  trùng tên trong tenant → `ConflictException` (409, backstop 23505 như các handler khác).

## Commands / Queries / Endpoints (route `/api/design/...`)

| Endpoint | Mô tả | Permission |
|---|---|---|
| `POST /api/design/projects` | `CreateDesignProjectCommand` (validator: name bắt buộc) → 201 `{id}` | `network-design:write` |
| `GET /api/design/projects/{id}` | `GetDesignProjectDetailQuery` → `DesignProjectDetailDto` (404 nếu thiếu) | `network-design:read` |
| `POST /api/design/projects/{projectId}/documents` | multipart upload → 201 `{id}` | `network-design:write` |

**Upload handler (2 bước — US-P2-02):**
1. Validate: project tồn tại + đúng tenant (không → 404; khác tenant → 404 tránh lộ id); `file` có mặt;
   `sizeBytes ≤ FileStorage:MaxSizeBytes`; `contentType ∈ AllowedContentTypes` → sai = **400**.
2. `IFileStoragePort.SaveAsync(...)` (lưu file trước) → `fileRef`. Storage ném → **502**, KHÔNG commit
   metadata.
3. Commit `DesignDocument` metadata + outbox event `design.document.uploaded` trong **1 UnitOfWork**.

`uploadedBy` lấy từ actor (security context); `documentType` từ form field (validate enum).

## Events (qua outbox, publish-only)

| Event | Version | Payload |
|---|---|---|
| `design.project.created` | v1 | `{projectId, tenantId, name, branchId?, zoneId?, occurredAt}` |
| `design.document.uploaded` | v1 | `{documentId, projectId, tenantId, fileName, contentType, sizeBytes, fileRef, documentType, occurredAt}` |

Đăng ký event types qua `AddOutboxDomainEventTypesFromAssembly` + `IIntegrationEventMapper` (pattern
asset-be). `tenantId` có trong payload (consistent multi-tenancy).

## Bảng xử lý lỗi

| Tình huống | Kết quả |
|---|---|
| Create project thiếu `name` | 400 (validation) |
| Create project trùng `(tenant, name)` | 409 ConflictException |
| GET project không tồn tại / khác tenant | 404 |
| Upload: project không tồn tại / khác tenant | 404 |
| Upload: file thiếu / quá size / sai contentType | 400 |
| Upload: storage lỗi | 502, metadata KHÔNG commit |
| Upload thành công | 201 + file trên đĩa + event trong outbox |
| Thiếu permission | 403 (downstream RequirePermission) |
| Không token | 401 |

## Test (TDD)

- **Unit**
  - `CreateDesignProjectCommandValidator`: name bắt buộc.
  - `CreateDesignProjectCommandHandler`: map field + raise `DesignProjectCreated`.
  - `UploadDesignDocumentCommandHandler`: thứ tự store-then-commit; **storage ném → không persist
    metadata + không raise event** (mock port ném); validate size/type.
  - `LocalDiskFileStorageAdapter`: save → file tồn tại + ref đúng (temp dir).
- **Integration** (`PostgisFixture`, `Jwt:Mode=Mock`, `EventBus:Transport=InMemory`)
  - Create project → 201; GET detail → đúng metadata + status `Open`.
  - Create trùng `(tenant,name)` → 409.
  - Upload multipart (`MultipartFormDataContent`) → 201; file tồn tại trên đĩa; row `design_documents`;
    event `design.document.uploaded` trong outbox.
  - Upload sai contentType / quá size → 400.
  - Upload khi storage fail → 502, không có row metadata (mock adapter cấu hình ném).
  - Tenant A không GET được project tenant B → 404.
- **Contract**: schema/round-trip 2 event publisher-side (pattern gis/asset ContractTests).

## Ngoài scope (ghi follow-up)

- Real `HttpFileStorageAdapter` → platform-core/file-storage-be (presigned URL).
- Download document endpoint; project list/search; Cancel project command.
- `DesignRevision` state machine, `DraftNetworkAsset`, validation engine, preview (DSN-2).
- PostGIS extension + NetTopologySuite (DSN-2).
- Compensating delete cho file mồ côi khi DB commit fail sau khi đã lưu file (mock hiện chấp nhận
  orphan; ghi nhận khi lên storage thật).
- `network-design:approve` permission + audit transition (DSN-3).

## Package mới

Không. Multipart dùng `IFormFile` (ASP.NET sẵn có); test multipart dùng `MultipartFormDataContent`
(System.Net.Http sẵn có).

## Definition of Done

- `dotnet test` xanh 0 warning trên solution design (unit + integration + contract).
- 3 endpoint đúng bảng xử lý lỗi; 2 event publish qua outbox; tenant isolation.
- `water-network-design-be` có Dockerfile + entry docker-compose (port 8084), DB `wn_design`.
- Conventional commit; checkbox plan tick đủ; roadmap §3.3 tick DSN-1.
