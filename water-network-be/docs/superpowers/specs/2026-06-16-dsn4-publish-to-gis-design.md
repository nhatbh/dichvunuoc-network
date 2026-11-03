# DSN-4 Publish → GIS (US-P2-06) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-design-be` + `water-network-gis-be` (Phase 2, slice DSN-4)
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §7.1 (publish-qua-event) + §7.3 #4 (slice DSN-4) + §7.4 (rủi ro riêng)
**Phụ thuộc:** DSN-3 (`DesignRevision` state machine `Draft → Validated → Submitted → Approved` + transition audit đã ship); GIS-1..3 (`RegisterNode`/`RegisterPipe`/`InstallDevice` domain logic đã ship); AST-1 (`IdempotentEnvelopeConsumer` building block + outbox/inbox đã ship).

## Bản chất

DSN-4 đóng **vòng publish** của design workflow: một `DesignRevision` đã `Approved` được đưa vào bản
đồ GIS — nhưng **không qua HTTP command đồng bộ** mà **qua event 2 chiều** (chốt §7.1, US-P2-06):

```text
revision Approved
   │  design-be consume design.revision.approved (outbox-backed retry)
   ▼  build batch payload từ draft assets của revision
   │  emit design.asset.ready-for-gis (v1, batch)
   ▼  [RabbitMQ]
gis-be consume → import theo thứ tự Node → Pipe → Device
   │  ledger (revisionId, draftAssetId) chống redelivery
   │  tạo asset qua chính domain logic NetworkNode.Register / NetworkPipe.Register / NetworkDevice.Install
   │  emit network.gis-import.completed {imported[], failed[]}
   ▼  [RabbitMQ]
design-be consume → MarkPublished / MarkPartiallyPublished + lưu import report
```

Lý do publish-qua-event (không HTTP design→GIS): không tạo phụ thuộc đồng bộ giữa 2 service, retry
tự nhiên qua outbox, idempotent theo `(revisionId, draftAssetId)`. GIS tái dùng **bất biến domain**
(factory `Register*`) nên dữ liệu publish đi qua đúng các invariant như dữ liệu nhập tay; đồng thời
`NodeRegistered`/`PipeRegistered`/`DeviceInstalled` vẫn bắn xuống asset-be như thường (tác dụng phụ
có lợi — asset profile tự tạo, không cần code thêm).

Kết thúc DSN-4: revision `Approved` có thể đi tiếp `Published` (toàn bộ imported) hoặc
`PartiallyPublished` (có failed), với import-report machine-readable cho FE; asset được tạo trong GIS
và idempotent trước redelivery.

**Ngoài scope (slice sau):**
- **Re-publish** draft `failed` sau khi sửa (DSN-5+). DSN-4: `Published`/`PartiallyPublished` là terminal.
- **Nối draft tới GIS asset có sẵn**: `fromRef/toRef/hostRef` chỉ là client-ref **nội batch** (ràng buộc
  từ DSN-2 validation `EndpointMustBeNode` resolve theo `ClientRef` cùng revision). Cross-revision/
  existing-asset ref để DSN-5+.
- Parse file CAD/PDF thành draft; bulk/cursor export GIS.

## Scope (DSN-4)

### Contracts (mới, 2 event)
1. `design.asset.ready-for-gis` v1 — design-be phát. Payload batch:
   `{ revisionId, projectId, tenantId, revisionNumber, approvedBy, assets[] }`, mỗi asset:
   `{ draftAssetId, kind, assetCode, clientRef, geometry{type,coordinates}, attributes{}, fromRef, toRef, hostRef }`.
2. `network.gis-import.completed` v1 — gis-be phát. Payload:
   `{ revisionId, tenantId, imported[]{draftAssetId, gisAssetId, kind, assetCode}, failed[]{draftAssetId, assetCode, reason} }`.
3. Event-catalog entries + ContractTests 2 phía (mirror DSN-3 pattern).

### design-be
4. `DesignRevisionStatus` += `Published`, `PartiallyPublished` (cột `status` đã `varchar(16)` — đủ chỗ).
5. `DesignRevision.MarkPublished(imported, failed, actorId, correlationId)`:
   - status = `failed.Count == 0 ? Published : PartiallyPublished`;
   - guard: chỉ cho phép từ `Approved` (transition không hợp lệ → `BusinessRuleException`);
   - ghi `DesignRevisionTransition` (audit) + raise domain event `DesignRevisionPublished`.
6. **Inbox + MassTransit consumer infra cho design-be** (service hiện publish-only — đây là consumer
   đầu tiên; cần wire `AddInbox` + `IdempotentEnvelopeConsumer` registration + `AddOutboxDomainEventTypesFromAssembly` đã có).
7. `RevisionApprovedPublishConsumer : IdempotentEnvelopeConsumer` — subscribe `design.revision.approved`:
   load drafts theo `revisionId`, build payload, raise `DesignAssetReadyForGis` domain event (outbox → bus).
8. `GisImportCompletedConsumer : IdempotentEnvelopeConsumer` — subscribe `network.gis-import.completed`:
   load revision → `MarkPublished` → persist + lưu import-report.
9. Bảng `design_import_results (revision_id, draft_asset_id, gis_asset_id?, status, reason, created_at)`
   + migration; endpoint `GET /api/network/design/revisions/{id}/publish-result` (permission `read`).

### gis-be
10. `DesignAssetImportConsumer : IdempotentEnvelopeConsumer` — subscribe `design.asset.ready-for-gis`:
    - xử lý batch **Node → Pipe → Device**, giữ map `clientRef → gisAssetId` trong batch;
    - mỗi draft: tra **ledger** `(revisionId, draftAssetId)` → có thì skip + reuse id (idempotent);
      chưa có thì tạo qua factory domain + repo (tenant từ payload), inject lại
      `IGeometryVersionStore` (node geometry-version append) + `IPipeLengthCalculator` (length + warning);
    - pipe/device resolve `fromRef/toRef/hostRef` qua map clientRef→gisId;
    - lỗi 1 draft (`ConflictException` trùng code / `BusinessRuleException` host-not-found / PG 23505) →
      ghi `failed[]`, **không** làm hỏng cả batch;
    - map `attributes{}` → tham số factory (`nodeType`; `diameterMm`/`material`/`lengthM`; `deviceType`/host);
    - sau batch: raise `NetworkGisImportCompleted` domain event → outbox → bus.
11. Bảng `gis_import_ledger (tenant_id, revision_id, draft_asset_id, gis_asset_id, kind, asset_code, created_at)`,
    unique `(revision_id, draft_asset_id)` + migration.

### Testing
12. Integration round-trip 2 chiều (design DB → MQ → gis DB → MQ → design DB) với 2 ApiFactory chia sẻ
    broker — 3 kịch bản: all-success → `Published`; 1 draft trùng code → `PartiallyPublished` + failed
    report; redelivery `ready-for-gis` → ledger no-op (không tạo trùng).
13. Unit: attribute→factory mapping (3 kind), ref-resolution nội batch, ledger idempotency, status selection.

## Quyết định chốt (đã brainstorm với user — 2026-06-16)

| # | Quyết định | Lý do |
|---|---|---|
| 1 | **Idempotency = import-ledger table** ở GIS, keyed `(revision_id, draft_asset_id)` → `gis_asset_id` | Rõ ràng, audit được, tách khỏi bảng asset, hỗ trợ report imported/failed tự nhiên; GIS asset id vẫn `Guid.CreateVersion7` (không đổi chữ ký factory). |
| 2 | **Status: `Published` + `PartiallyPublished`, terminal, không re-publish** trong DSN-4 | YAGNI; re-publish failed để slice sau khi product chốt UX sửa-rồi-publish-lại. |
| 3 | **GIS materialize = domain factory + repo trực tiếp** trong consumer (mirror `GisAssetRegistrationConsumer`), tenant từ payload | `ITenantContextAccessor` read-only (HTTP-scoped); không đụng building-block; nhất quán với consumer sẵn có; tái dùng bất biến domain + service (`IGeometryVersionStore`, `IPipeLengthCalculator`). Đổi lại: lặp lại orchestration nhẹ (geometry-version append, length calc). |
| 4 | **Trigger = design-be consume `design.revision.approved` của chính nó** (không emit thẳng trong Approve handler) | Tách approval khỏi publish; publish là reaction có outbox-backed retry (backlog DSN-4). Cần inbox infra mới cho design-be. |
| 5 | **Ref resolution = client-ref nội batch, ordering Node→Pipe→Device, GIS tự resolve** | Hệ quả của DSN-2 (`byRef[d.ClientRef]`); GIS sinh id nên chỉ GIS resolve được clientRef→gisId. |

## Component boundaries

- **`design.asset.ready-for-gis` / `network.gis-import.completed`** — hợp đồng duy nhất giữa 2 service;
  versioned v1; thay đổi shape = bump version.
- **`gis_import_ledger`** — chỉ `DesignAssetImportConsumer` ghi/đọc; cô lập hoàn toàn khỏi bảng asset.
- **`DesignAssetImportConsumer`** — đơn vị duy nhất biết cách map draft→GIS asset; resolve ref + ledger
  + factory ở một chỗ, test độc lập qua fixture giả payload.
- **`MarkPublished`** — invariant chuyển trạng thái nằm trong aggregate `DesignRevision`, không rò ra consumer.
- **`design_import_results`** — read-model cho FE, tách khỏi state machine.

## Rủi ro & xử lý

- **design-be chưa có inbox/consumer infra** (publish-only) → DSN-4 phải dựng (lớn nhất trong slice).
  Tái dùng đúng pattern asset-be/gis-be; có integration test cho dedup.
- **Coordinate order**: draft geometry coords là `[lng, lat]` (GeoJSON); node Point → `(lat, lng)` cho
  `GeoPoint`. Mapping phải đảo đúng — có unit test khẳng định round-trip toạ độ.
- **Outbox đăng ký event types**: cả 2 service đã/đang gọi `AddOutboxDomainEventTypesFromAssembly` cho
  domain event mới (`DesignAssetReadyForGis`, `DesignRevisionPublished`, `NetworkGisImportCompleted`) —
  nếu quên, typed mapper nhận generic carrier → không publish (xem backlog follow-up GIS-3 outbox).
- **Poison batch**: 1 draft fail = ghi `failed[]` (không throw) → không churn retry; chỉ lỗi hạ tầng
  (DB/bus down) mới để consumer throw → inbox retry.

## Liên hệ tài liệu

- Roadmap §7.1 (publish-qua-event), §7.3 #4 (slice DSN-4), §7.4 (rủi ro riêng).
- Backlog `docs/stories/backlog.md` "Follow-up sau DSN-3" — DSN-4 là slice kế tiếp; lưu ý
  `Approved.Reason` serialize `"Reason": null` (consumer contract phải handle).
- Decision record: cân nhắc DR mới nếu contract event publish→GIS cần chốt versioning/ownership
  (architecture/contract change theo CLAUDE.md).
