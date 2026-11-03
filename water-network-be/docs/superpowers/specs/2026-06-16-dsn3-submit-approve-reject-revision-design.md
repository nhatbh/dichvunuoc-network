# DSN-3 Submit / Approve / Reject Design Revision (US-P2-05) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-design-be` (Phase 2, slice DSN-3)
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §7.3 (slice DSN-3) + §15.2 (US-X-01 kích hoạt)
**Phụ thuộc:** DSN-2 (DesignRevision + DraftNetworkAsset + ValidateRevision đã ship; state machine `Draft → Validated`).

## Bản chất

DSN-3 đóng **vòng phê duyệt** của design workflow: một `DesignRevision` đã `Validated` (0 lỗi
nghiệp vụ) được **submit để xin duyệt**, người có quyền **approve** (cho phép publish ở DSN-4) hoặc
**reject** (trả về Draft kèm lý do để designer sửa). Đây cũng là **điểm kích hoạt đầu tiên của
cross-cutting US-X-01** — permission nhạy quyền thật (`network-design:approve`) lần đầu được enforce
trên endpoint, và mọi transition phải có **audit** (ai, khi nào, vì sao).

Kết thúc DSN-3: revision có thể đi `Validated → Submitted → Approved`, hoặc bị `Submitted → Draft`
(reject), với lịch sử transition append-only đầy đủ; sẵn cho DSN-4 (publish `Approved` → GIS).

**Ngoài scope (DSN sau):** publish→GIS qua event (`Approved → Published`, DSN-4); parse file CAD/PDF
thành draft; chỉnh sửa quyền/role thật (Keycloak — sau Phase 3, §15.2); chỉ enforce permission qua
claim `permission` (đã có sẵn `RequirePermission`).

## Scope (DSN-3)

1. `DesignRevisionStatus` mở rộng: thêm `Submitted`, `Approved` (cột `status` đã `varchar(16)` — đủ chỗ).
2. Aggregate `DesignRevision` thêm 3 transition method: `Submit`, `Approve`, `Reject` + invariant chặn
   draft-mutation khi `Submitted`/`Approved`.
3. Child entity append-only `DesignRevisionTransition` + migration `AddDesignRevisionTransitions`
   (bảng `design_revision_transitions`).
4. 3 command + handler: `SubmitDesignRevisionCommand`, `ApproveDesignRevisionCommand`,
   `RejectDesignRevisionCommand` (tenant-scoped, actor từ `RequestContext`).
5. 3 endpoint `POST /api/design/revisions/{id}/submit|approve|reject` + permission
   (`write` cho submit, `approve` cho approve/reject).
6. Events `design.revision.submitted`, `design.revision.approved`, `design.revision.rejected` v1
   (outbox, publish-only) + contract test 2 phía.
7. Revision-detail query trả thêm transition history; query history (hoặc nhúng vào detail).
8. Decision record: US-X-01 permission enforcement lần đầu (security + contract).

## Quyết định chốt (đã brainstorm với user — 2026-06-16)

| # | Quyết định | Chọn | Ghi chú |
|---|---|---|---|
| 1 | Reject target state | **Về `Draft`** (editable lại) | Khớp diagram roadmap §7.1 (reject loop về "sửa draft assets"). Không có state `Rejected` lưu trú; lý do reject lưu ở bảng transition. |
| 2 | Audit storage | **Bảng append-only `design_revision_transitions`** | Nhất quán pattern `AssetLifecycleEntry` / incident timeline. Child entity của aggregate; query history được. |
| 3 | Permission | **Submit = `network-design:write`; Approve/Reject = `network-design:approve`** | §15.2 — approve là hành động nhạy quyền đầu tiên; designer tự submit (write). |
| 4 | Reason | **Reject bắt buộc; Approve optional; Submit không cần** | Reject cần lý do để designer biết sửa gì. |
| 5 | API path | **Giữ `/api/design/revisions/{id}/...`** | Nhất quán DSN-1/DSN-2 nội bộ design-be (route platform `/api/network` thuộc gateway YARP — §15.2, ngoài scope). |

## Domain model

### `DesignRevisionStatus` (enum mở rộng)

```text
Draft, Validated, Submitted, Approved
```

`Published` thêm ở DSN-4. **Không** có giá trị `Rejected` (reject → `Draft`).

### State machine DSN-3

```text
Draft ──validate (0 error)──► Validated ──Submit──► Submitted ──Approve──► Approved
  ▲                                                    │ Reject (reason bắt buộc)        (→ Published, DSN-4)
  └────────────────────────────────────────────────────┘
```

Bất biến transition (vi phạm → `DomainException` → 422 `BUSINESS_RULE.InvalidRevisionTransition`):

- `Submit`: chỉ từ `Validated`. (Từ `Draft` chưa validate, hoặc đã `Submitted`/`Approved` → 422.)
- `Approve`: chỉ từ `Submitted`.
- `Reject`: chỉ từ `Submitted` → `Draft`; `reason` bắt buộc (rỗng/null → validator 400 trước khi vào domain; domain cũng guard backstop).
- **Draft-mutation guard (mới):** `CreateDraftAsset` / `CreateDraftAssetsBatch` / `UpdateDraftGeometry`
  chỉ cho phép khi revision ở `Draft` hoặc `Validated`. Khi `Submitted`/`Approved` → 422
  `BUSINESS_RULE.RevisionNotEditable`. (Hiện `MarkDraftsChanged` chỉ reset từ `Validated`; bổ sung
  guard cứng ở handler/domain để revision đã submit không bị đổi draft ngầm.)

### `DesignRevision` (aggregate — bổ sung)

3 method mới, mỗi method: validate transition → đổi `Status` (+ `MarkAsModified`) → append
`DesignRevisionTransition` → `AddDomainEvent`.

| Method | Chữ ký | Event raise |
|---|---|---|
| `Submit` | `Submit(string actorId, string? correlationId)` | `DesignRevisionSubmitted` |
| `Approve` | `Approve(string actorId, string? reason, string? correlationId)` | `DesignRevisionApproved` |
| `Reject` | `Reject(string actorId, string reason, string? correlationId)` | `DesignRevisionRejected` (toStatus = `Draft`) |

Khi `Reject` đưa về `Draft`, `ValidationResult` được giữ nguyên hay xóa? → **Xóa** (`null`), buộc
designer validate lại sau khi sửa — nhất quán với `MarkDraftsChanged`.

### `DesignRevisionTransition` (child entity, append-only)

| Field | Ghi chú |
|---|---|
| `id` | UUIDv7 |
| `revisionId` | FK → `design_revisions.id` |
| `tenantId` | multi-tenancy |
| `fromStatus`, `toStatus` | `DesignRevisionStatus` (string) |
| `actorId` | từ `RequestContext.UserId`; null → sentinel `"unknown"` (pattern DSN-1 `UploadedBy`) |
| `reason` | nullable; bắt buộc với reject (enforce ở validator + domain) |
| `correlationId` | từ `RequestContext.CorrelationId` (trace audit) |
| `occurredAt` | `DateTime.UtcNow` |

Append-only: không update/delete (giống `geometry_versions`). Load cùng aggregate khi cần emit/replay,
nhưng để **không phình aggregate**, transition mới được add vào collection của aggregate trong transition
method; repo persist phần mới (insert-only) — xem Persistence.

## Persistence

Migration mới `AddDesignRevisionTransitions`:

```sql
create table design_revision_transitions (
  id varchar(64) primary key,
  revision_id varchar(64) not null,
  tenant_id varchar(64) not null,
  from_status varchar(16) not null,
  to_status varchar(16) not null,
  actor_id varchar(64) not null,
  reason text null,
  correlation_id varchar(128) null,
  occurred_at timestamptz not null,
  constraint fk_revision_transitions_revision
    foreign key (revision_id) references design_revisions(id) on delete restrict);
create index ix_revision_transitions_tenant_revision
  on design_revision_transitions (tenant_id, revision_id);
```

`design_revisions.status` không đổi schema (đã `varchar(16)`); chỉ enum domain mở rộng.

**Repository (`DesignRevisionRepository`):**
- `PersistAsync`: giữ optimistic concurrency hiện có cho revision row; **insert** các transition mới
  (aggregate expose pending transitions hoặc repo so sánh — chọn: aggregate giữ `_newTransitions`
  list, repo đọc và `AddRange`, rồi aggregate clear sau persist — tương tự domain events).
- `GetByIdAsync`: DSN-3 không cần load transitions để thực hiện transition (chỉ cần status hiện tại +
  version). Transitions chỉ đọc qua ReadDao cho query history → **không** load vào aggregate khi mutate
  (tránh N+1 / phình). Aggregate chỉ tích lũy transition *mới* trong vòng đời request.

**ReadDao (`DesignRevisionReadDao`):** thêm `ListTransitionsAsync(tenantId, revisionId)` trả
`IReadOnlyList<RevisionTransitionDto>`; nhúng vào `DesignRevisionDetailDto` (field `transitions`).

## Application

| Command | Validator (400) | Handler rule |
|---|---|---|
| `SubmitDesignRevisionCommand(revisionId)` | revisionId not empty | load tenant-scoped → `Submit(actor, corr)` → save. Sai state → 422. |
| `ApproveDesignRevisionCommand(revisionId, reason?)` | revisionId not empty | `Approve(actor, reason, corr)` → save. |
| `RejectDesignRevisionCommand(revisionId, reason)` | revisionId + **reason not empty** | `Reject(actor, reason, corr)` → save. |

- Actor lấy từ `IRequestContextProvider.Current()?.UserId` ?? `"unknown"`; correlationId từ cùng context.
- Tenant-scope: load revision theo `(tenantId, id)`; không thấy → `NotFoundException` (404, ẩn cross-tenant id — mirror DSN-1/AST-3 follow-up).
- Draft-mutation guard: bổ sung check vào 3 draft command handler hiện có (`CreateDraftAsset*`,
  `UpdateDraftGeometry`): nếu revision `Submitted`/`Approved` → 422 `RevisionNotEditable`.

## API & Contract

`RevisionsEndpointModule` thêm 3 endpoint (group `/api/design/revisions`):

| Endpoint | Command | Permission | Response |
|---|---|---|---|
| `POST /{revisionId}/submit` | Submit | `network-design:write` | 200 (revision detail) / 422 / 404 / 403 |
| `POST /{revisionId}/approve` | Approve (body `{reason?}`) | `network-design:approve` | 200 / 422 / 404 / 403 |
| `POST /{revisionId}/reject` | Reject (body `{reason}`) | `network-design:approve` | 200 / 400 (thiếu reason) / 422 / 404 / 403 |

Approve/Reject nhận JSON body optional/required reason qua `.WithValidation<>` (request record trong
`Contracts/Requests`). Submit không body.

**Integration events v1** (outbox publish-only, mapper trong design-be):

| Event | Payload |
|---|---|
| `design.revision.submitted` | `{revisionId, projectId, tenantId, revisionNumber, actorId}` |
| `design.revision.approved` | `{revisionId, projectId, tenantId, revisionNumber, actorId, reason?}` |
| `design.revision.rejected` | `{revisionId, projectId, tenantId, revisionNumber, actorId, reason}` |

Chưa có consumer Phase 2 (DSN-4 consume `approved` để trigger publish → để ngỏ, chỉ chốt contract +
contract test 2 phía như §15.1). Outbox `AddOutboxDomainEventTypesFromAssembly` đã đăng ký ở design-be
(kiểm tra DSN-2) — thêm 3 domain event type mới vào mapper.

## Cross-cutting US-X-01 (kích hoạt lần đầu — §15.2)

- `network-design:approve` là permission đầu tiên enforce thật trên hành động nhạy quyền. Endpoint khai
  báo qua `.RequirePermission("network-design:approve")` (helper Security building-block đã có).
- **Tenant-scope check:** permission đúng nhưng sai tenant → 404 (load tenant-scoped, ẩn id-enumeration);
  test bắt buộc "tenant A approve revision tenant B → 404".
- Decision record `docs/decisions/0014-design-approval-permission-and-audit.md`: chốt (a) policy naming
  `<context>:<action>`, (b) audit transition append-only, (c) actor sentinel `"unknown"` khi thiếu claim.

## Testing (DoD §17)

- **Domain unit test (matrix):** mọi transition hợp lệ (`Validated→Submitted`, `Submitted→Approved`,
  `Submitted→Draft`) + mọi transition không hợp lệ (vd `Draft→Submit`, `Approved→Submit`,
  `Validated→Approve`, `Draft→Reject`) → `DomainException`; reject thiếu reason → exception; mỗi
  transition tạo đúng 1 `DesignRevisionTransition` + đúng 1 domain event; reject xóa `ValidationResult`.
- **Draft-mutation guard test:** create/update draft khi `Submitted`/`Approved` → 422.
- **Handler test:** actor/correlation lấy từ RequestContext; tenant mismatch → NotFound.
- **API E2E:** happy submit→approve; submit→reject (reason); 422 sai state; 403 thiếu permission
  (token không có claim `approve`); 400 reject thiếu reason; 404 cross-tenant.
- **Contract test 2 phía** cho 3 event mới (pattern `NetworkNodeRegisteredContractTests`).
- `dotnet test water-network-design-be.slnx` xanh, 0 warning; compose parse; cập nhật event-catalog +
  template-mapping nếu sinh pattern mới.

## Files dự kiến đụng tới

**Domain:** `ValueObjects/DesignRevisionStatus.cs` (thêm 2 value), `Aggregates/DesignRevision.cs`
(3 method + `_newTransitions`), `Entities/DesignRevisionTransition.cs` (mới),
`DomainEvents/DesignRevisionSubmitted|Approved|Rejected.cs` (mới).

**Application:** `Commands/Submit|Approve|RejectDesignRevisionCommand.cs` + handlers + validators;
`Dtos/RevisionTransitionDto.cs` + mở rộng `DesignRevisionDetailDto`; `Ports/IDesignRevisionReadDao.cs`
(thêm `ListTransitionsAsync`); guard ở 3 draft command handler.

**Infrastructure:** migration `AddDesignRevisionTransitions` + `DesignRevisionTransitionPersistenceModel`
+ configuration; `DesignRevisionRepository.PersistAsync` (insert transitions); `DesignRevisionReadDao`
(transitions); outbox mapper + `AddOutboxDomainEventTypesFromAssembly` 3 event mới.

**Contracts:** `Requests/ApproveRevisionRequest.cs`, `RejectRevisionRequest.cs`;
`Events/DesignRevisionSubmitted|Approved|Rejected*.cs`.

**Api:** `RevisionsEndpointModule.cs` (3 endpoint).

**Docs:** decision `0014-...`; `docs/conventions/event-catalog.md` (3 event); backlog follow-up.
