# GIS-5 Projection `network_asset_states` (US-P1-06) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-gis-be` (+ refactor nhỏ `water-network-asset-be`)
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §4.4–4.5 (slice GIS-5)
**Phụ thuộc:** AST-2 contract `asset.status.changed` + AST-1 `asset.registered` (đã merge).

## Scope

GIS xây **projection cục bộ** `network_asset_states` — bản chiếu trạng thái vòng đời asset
(do asset-be sở hữu) vào DB của GIS để bbox query trả `lifecycleStatus` mà không gọi sync
asset-be. Đây là pattern "view can be composed, write must be owned" (roadmap §2.2 #2):
projection là dữ liệu của GIS, được phép trễ, được phép null khi chưa sync.

Luồng end-to-end: integration event (`asset.registered` / `asset.status.changed`) → consumer
GIS qua Inbox (idempotent theo `eventId`) → upsert `network_asset_states` (có ordering guard)
→ bbox query `LEFT JOIN` projection → trả `lifecycleStatus`.

Gộp vào slice (đóng follow-up backlog):

1. **Promote `IdempotentEnvelopeConsumer` base class** lên building-blocks (trigger "consumer
   thứ 2" — backlog "Follow-up sau AST-1"). Refactor `GisAssetRegistrationConsumer` (asset-be)
   onto base + dùng cho consumer GIS mới → hết 2 bản copy filter/inbox-dedup.
2. **Bbox `lifecycleStatus`** — đóng follow-up GIS-4 ("lifecycleStatus deferred"): handler đang
   hardcode `null`, DTO field đã ship sẵn.

**Ngoài scope (ghi follow-up):**

- `asset.decommissioned` consumer — KHÔNG subscribe (redundant: `asset.status.changed` đã mang
  `newStatus = "Decommissioned"`). Thêm nếu sau cần `reason`/`decommissionedBy` trong projection.
- `asset.technical-profile.updated` — projection chỉ giữ lifecycle status, không profile.
- Cross-tenant mutation guard (US-X-01) — projection là read-path, đã tenant-scoped; không đụng.
- Per-event-type exchange routing (vẫn 1 exchange chung, filter theo `EventType`).

## Quyết định chốt (đã brainstorm với user — 2026-06-15)

| # | Quyết định | Chọn | Ghi chú |
|---|---|---|---|
| 1 | Event subscribe | `asset.registered` (seed) + `asset.status.changed` (transition). KHÔNG `asset.decommissioned` | registration chỉ emit `asset.registered` (Status=Active), KHÔNG emit status.changed → phải seed để bắt initial Active |
| 2 | Ordering / reorder | Upsert có **OccurredAt guard**: chỉ đè khi `excluded.updated_at >= stored.updated_at` | Inbox chỉ chặn redelivery trùng eventId, không chặn reorder 2 event khác → guard chống regress status |
| 3 | Base class | Promote `IdempotentEnvelopeConsumer` lên building-blocks ngay trong slice này | Refactor cả asset-be + gis-be dùng chung |
| 4 | Projection shape | Minimal: `{asset_id, tenant_id, lifecycle_status, updated_at, last_event_id}` | YAGNI — assetId là join key duy nhất; không cần asset_type |
| 5 | Initial Active | Seed từ `asset.registered` (xem #1) | Tránh projection rỗng cho asset chưa từng transition; vẫn hợp US-P1-06 (null chỉ khi chưa nhận event nào) |
| 6 | Nguồn tenant | **Derive từ bảng GIS cục bộ** (`SELECT tenant_id FROM network_{nodes\|pipes\|devices} WHERE id = @assetId`, chọn bảng theo `Data.AssetType`) | ⚠️ Sửa quyết định brainstorm ban đầu: `envelope.TenantId` = **null** cho event publish qua outbox (xác nhận ở `MassTransitIntegrationEventPublisher` — ambient tenant null trong OutboxProcessor scope); `AssetStatusChangedV1` cũng KHÔNG có TenantId. asset_id == GIS asset id (decision #2) + asset sinh từ GIS event → row GIS luôn tồn tại trước → tra ngược tenant cục bộ luôn được. Khớp backlog "lấy từ source-aggregate". |

## Trạng thái hiện có (đã verify trong code)

- **Contract sẵn** (asset-be `Contracts/Events`):
  - `AssetRegisteredV1(AssetId, TenantId, AssetType, AssetCode, Status)` — Status="Active".
  - `AssetStatusChangedV1(AssetId, AssetType, PreviousStatus, NewStatus, Reason, ChangedBy)` — **không TenantId**.
- **Envelope**: `IntegrationEventEnvelope` có `TenantId`, `EventId`, `EventType`, `OccurredAt`, `Payload` (JSON với property `Data`).
- **Consumer mẫu**: `GisAssetRegistrationConsumer` (asset-be) — `IConsumer<IntegrationEventEnvelope>` + core broker-free `HandleEnvelopeAsync` + filter `EventType` + inbox `HasBeenProcessedAsync`/`MarkAsProcessedAsync` + local `IsUniqueViolation`. **gis-be CHƯA có consumer nào** (đây là consumer đầu tiên của gis-be).
- **Bbox**: `AssetFeatureCollectionDto` đã có field `string? LifecycleStatus`; `GetAssetsInBboxQueryHandler` hardcode `LifecycleStatus: null`; `BboxAssetReadDao` UNION ALL 3 bảng (`BboxAssetRow`), chưa join projection.

## Thiết kế chi tiết

### A. Building block — `IdempotentEnvelopeConsumer`

Abstract base trong `WaterPlatform.BuildingBlocks.Infrastructure.Events`:

- Constructor nhận `IInboxMessageStore` + `ILogger`.
- Subclass khai báo: `ConsumerName` (string), tập `EventType` subscribe (vd `Subscribes(string eventType) → bool` hoặc `IReadOnlySet<string> SubscribedEventTypes`), và core `HandleAsync(IntegrationEventEnvelope, CancellationToken)`.
- Template method `HandleEnvelopeAsync`: (1) filter `EventType` → bỏ qua nếu không subscribe; (2) `HasBeenProcessedAsync(ConsumerName, EventId)` → return nếu đã xử lý; (3) gọi `HandleAsync`; (4) `MarkAsProcessedAsync`.
- `IConsumer<IntegrationEventEnvelope>.Consume` → gọi `HandleEnvelopeAsync` (giữ core broker-free để integration-test không cần MassTransit — pattern hiện tại).
- **Refactor** `GisAssetRegistrationConsumer` (asset-be) kế thừa base (giữ nguyên hành vi + test xanh). `IsUniqueViolation` vẫn ở asset-be (chưa promote — không thuộc slice này).

### B. GIS consumer — `AssetLifecycleProjectionConsumer`

`water-network-gis-be` / Infrastructure / Consumers. Kế thừa `IdempotentEnvelopeConsumer`.

- `ConsumerName = "gis.asset-lifecycle-projection"`.
- Subscribe: `asset.registered`, `asset.status.changed`.
- `HandleAsync`: parse `envelope.Payload` → root có `Data` + `OccurredAt` (integration-event level); lấy `assetId` + `assetType` + status (`Status` cho registered, `NewStatus` cho status.changed) từ `Data`.
- **Tenant**: gọi `IAssetTenantLookupDao.GetTenantAsync(assetId, assetType, ct)` → `SELECT tenant_id FROM network_{nodes|pipes|devices} WHERE id = @assetId` (bảng theo assetType). Null (asset GIS không tồn tại — bất thường) → throw để retry/dead-letter (không nuốt).
- Gọi `IAssetStateProjectionStore.UpsertAsync(assetId, tenantId, status, occurredAt, envelope.EventId, ct)`. Dùng `OccurredAt` từ payload integration-event (`envelope.OccurredAt` cũng có cùng giá trị — dùng envelope cho gọn).

### C. Projection store + Migration M5

Port `IAssetStateProjectionStore` (Application) + adapter Dapper (Infrastructure). Không có
domain layer — projection là read model thuần, không aggregate.

```sql
-- M5: network_asset_states
create table network_asset_states (
  asset_id         uuid primary key,
  tenant_id        text not null,
  lifecycle_status text not null,
  updated_at       timestamptz not null,
  last_event_id    text not null);
create index ix_asset_states_tenant on network_asset_states (tenant_id);
```

Upsert có ordering guard:

```sql
insert into network_asset_states (asset_id, tenant_id, lifecycle_status, updated_at, last_event_id)
values (@assetId, @tenantId, @status, @occurredAt, @eventId)
on conflict (asset_id) do update
  set lifecycle_status = excluded.lifecycle_status,
      updated_at       = excluded.updated_at,
      last_event_id    = excluded.last_event_id
  where excluded.updated_at >= network_asset_states.updated_at;
```

`@occurredAt = envelope.OccurredAt`. Reorder (event cũ tới sau) → `WHERE` false → no-op, status không regress.

### D. Bbox query — populate `lifecycleStatus`

- `BboxAssetReadDao`: thêm `LEFT JOIN network_asset_states s ON s.asset_id = <table>.id AND s.tenant_id = @tenantId` cho cả 3 nhánh select; thêm cột `s.lifecycle_status AS LifecycleStatus` vào `BboxAssetRow`.
- `GetAssetsInBboxQueryHandler`: map `LifecycleStatus` từ row thay vì hardcode `null`.
- Giữ nguyên cột `Status` (GIS-local) — độc lập `lifecycleStatus`.
- Asset Decommissioned (asset-be) vẫn hiện trong bbox với `lifecycleStatus: "Decommissioned"` (GIS chưa soft-delete geometry) — FE tự style.

### E. Wiring (`Program.cs` gis-be)

- Đăng ký MassTransit consumer `AssetLifecycleProjectionConsumer` (lần đầu gis-be có consumer side).
- Đăng ký `IInboxMessageStore` + inbox migration cho gis DB (nếu chưa có bảng inbox ở gis).
- Đăng ký `IAssetStateProjectionStore`.

## Tests (TDD — viết trước implementation)

| Tầng | Test |
|---|---|
| Unit (projection store) | upsert tạo mới; upsert đè (OccurredAt mới hơn); **guard** — OccurredAt cũ hơn → không đè |
| Unit (base class) | filter EventType bỏ qua event lạ; inbox dedup skip; core gọi đúng 1 lần |
| Integration (2 fixture) | `asset.registered` → row `Active`; rồi `status.changed(Suspended)` → `Suspended`; deliver-twice cùng eventId → 1 hiệu ứng; out-of-order (status cũ tới sau) → không regress; **tenant isolation** (A không thấy projection B qua bbox) |
| Contract (consumer-side) | GIS đọc đúng shape `AssetRegisteredV1` + `AssetStatusChangedV1` |
| Integration (bbox) | asset có projection → `lifecycleStatus` đúng; không có → `null` |
| Regression | `GisAssetRegistrationConsumer` (asset-be) sau refactor base class vẫn xanh |

## Rủi ro / lưu ý

- **gis-be lần đầu là consumer** → cần inbox infra ở gis DB; verify `IInboxMessageStore` + migration tồn tại trước khi viết consumer test.
- **Phantom row order-independence**: pure upsert theo `asset_id` (không FK tới bảng asset GIS) → status.changed tới trước registered vẫn tạo row đúng (guard giữ status mới nhất).
- **Refactor base class chạm asset-be** → DoD phải chạy test CẢ 2 solution (asset-be + gis-be).

## Sau slice

- Decision record **0013**: projection ordering guard + seed-from-registered + base class promotion.
- Event catalog (`docs/conventions/event-catalog.md`): thêm gis-be là consumer của `asset.registered` + `asset.status.changed`.
- `template-mapping.md`: ghi pattern `IdempotentEnvelopeConsumer` base class.
- Tick checkbox GIS-5 trong roadmap; cập nhật backlog (đóng follow-up GIS-4 lifecycleStatus + AST-1 base-class).
- **DoD**: `dotnet test` xanh 0 warning cả 2 solution; `docker compose config --quiet` parse; conventional commit.
