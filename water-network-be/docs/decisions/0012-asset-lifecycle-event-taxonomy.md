# 0012 AST-2 Asset Lifecycle Event Taxonomy

Date: 2026-06-15

## Status

Accepted

## Context

`water-network-asset-be` nhận 5 commands vòng đời trong slice AST-2:
`ActivateAsset`, `MarkAssetAsMaintenance`, `SuspendAsset`, `DecommissionAsset`,
`UpdateAssetTechnicalProfile`. Mỗi command cần phát ít nhất một integration event
để GIS-5 (và sau này maintenance/observation) cập nhật projection.

Roadmap §5.3 liệt kê danh sách đầy đủ gồm `asset.activated`,
`asset.maintenance-marked`, `asset.status.changed`, `asset.decommissioned`,
`asset.technical-profile.updated`. Câu hỏi: **phát event nào cho mỗi transition,
và vào thời điểm nào thêm các event semantic riêng?**

Ngoài ra, slice này có hai đặc điểm kỹ thuật cần ghi nhận rõ:

1. `DecommissionAsset` nâng một aggregate version duy nhất nhưng raise **2 domain
   events** — cần đảm bảo bookkeeping `expectedVersion = Version - events.Count`
   trong outbox/concurrency vẫn đúng.
2. `UpdateAssetTechnicalProfile` có tham số `changedBy` (actor) nhưng chưa có nhu
   cầu lưu vào audit trail riêng; quyết định về persistence cần tường minh.

## Decision

### 1. Universal signal: `asset.status.changed`

Mỗi transition (Activate / MarkAsMaintenance / Suspend / Decommission) đều emit
**`asset.status.changed` v1** — đây là contract duy nhất mà GIS-5 (và các consumer
tương lai: maintenance, observation) đọc. Payload `AssetStatusChangedV1`:

```json
{
  "assetId": "…",
  "assetType": "Node|Pipe|Device",
  "previousStatus": "Active",
  "newStatus": "Suspended",
  "reason": "…|null",
  "changedBy": "…"
}
```

Lý do chọn single universal signal thay vì N event semantic:
- GIS-5 chỉ cần biết `(assetId, newStatus)` để upsert projection — không cần phân
  biệt "activated vs maintenance-marked".
- Giảm bề mặt contract; thêm event semantic sau là non-breaking (consumer cũ chỉ
  handle `asset.status.changed`).

### 2. Terminal supplement: `asset.decommissioned`

Khi `DecommissionAsset`, aggregate raise **thêm** `asset.decommissioned` v1 — phát
đồng thời cùng `asset.status.changed` trong cùng transaction outbox. Payload
`AssetDecommissionedV1` chứa `reason` và `decommissionedBy` (actor), vì thông tin
này có ý nghĩa nghiệp vụ riêng (quản lý, kiểm toán) mà `asset.status.changed`
không capture đủ.

### 3. Profile event: `asset.technical-profile.updated`

`UpdateAssetTechnicalProfile` emit **`asset.technical-profile.updated` v1**. Payload
`AssetTechnicalProfileUpdatedV1` chứa các field cứng (`installationYear`,
`manufacturer`, `model`) và **không** chứa loose attributes (queryable qua
`GET /api/assets/{id}` — tránh inflate payload event với dữ liệu không cần thiết
cho downstream).

### 4. Deferred: event semantic riêng (`asset.activated`, `asset.maintenance-marked`)

`asset.activated` và `asset.maintenance-marked` — được liệt kê trong roadmap §5.3
— **KHÔNG** phát trong AST-2. Quyết định YAGNI: không có consumer Phase-1 nào cần
phân biệt semantic "activated" vs chỉ đọc `newStatus == "Active"` trong
`asset.status.changed`. Thêm khi consumer đầu tiên yêu cầu phân biệt này — khi đó
chỉ cần extend outbox mapper, không breaking đối với consumer hiện tại.

### 5. Version bookkeeping với multi-event transition

`DecommissionAsset` raise **2 domain events** (`AssetStatusChanged` + `AssetDecommissioned`).
`AggregateRepositoryBase.SaveAsync` tính `expectedVersion = aggregate.Version - events.Count`.
Do đó `Decommission()` phải tăng `Version` **thêm 2** (gọi `MarkAsModified()` hai lần,
hoặc `Version += 2`) để đẳng thức concurrency/outbox còn đúng:

```
expectedVersion = (storedVersion + 2) - 2 = storedVersion  ✓
```

Các transition 1-event tăng Version thêm 1 như bình thường.

**Quy tắc tổng quát:** N domain events trong một transition → `Version += N`.

### 6. `changedBy` trên `UpdateTechnicalProfile`

Tham số `changedBy` có trong chữ ký command (đối xứng với các command lifecycle)
nhưng **không** được persist vào profile entity trong AST-2 — chưa có audit trail
riêng cho profile. Giá trị được ghi vào domain event `asset.technical-profile.updated`
để downstream có thể track nếu cần. Wire vào persistence khi có nhu cầu audit trail
tường minh (xem Follow-ups).

## Consequences

- GIS-5 (slice tiếp theo) subscribe **duy nhất** `asset.status.changed` + tuỳ chọn
  `asset.decommissioned` — không cần biết về `asset.activated`/`asset.maintenance-marked`.
- Contract test `AssetStatusChangedContractTests` và `AssetDecommissionedContractTests`
  là gate merge của AST-2; GIS-5 phải viết consumer test chống cùng payload shape.
- `Decommission` phải được test tường minh: raise 2 events, Version += 2, outbox
  publish 2 messages. Test đã có trong `NetworkAssetLifecycleTests` và
  `NetworkAssetRepositoryTests`.

## Follow-ups (ghi nhận tường minh)

1. **`BaseException.Code` → ProblemDetails extension**: hiện tại rule code (vd
   `BUSINESS_RULE.InvalidAssetTransition`) chỉ readable qua tiền tố `[RuleCode]`
   trong `detail` string. Cân nhắc surface `Code` ra extension field trong
   `ProblemDetails` response để client có thể parse machine-readable mà không cần
   parse string. Trigger: khi FE/integration cần phân biệt rule code bằng code,
   không phải bằng message.

2. **`changedBy` audit trail cho technical profile**: `changedBy` actor hiện chỉ
   trong event payload, không persist vào DB. Wire vào `AssetTechnicalProfile` entity
   hoặc bảng audit riêng khi nghiệp vụ cần truy vết "ai sửa profile lần cuối".

3. **Reason trên Suspend/Activate (bodyless command)**: hiện tại endpoint
   `POST /api/assets/{id}/suspend` và `…/activate` không có request body — reason
   là `null`. Thêm body `{ "reason": "…" }` nếu product cần operator ghi lý do khi
   suspend/activate (non-breaking thêm sau: body optional với default null).

4. **`asset.activated` / `asset.maintenance-marked`**: emit khi có consumer đầu
   tiên cần semantic phân biệt (maintenance-be, observation-be — Phase 4/5). Không
   breaking đối với GIS-5 vì chỉ thêm event type mới, không đổi existing payload.
