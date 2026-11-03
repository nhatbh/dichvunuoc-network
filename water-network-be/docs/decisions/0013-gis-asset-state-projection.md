# 0013 GIS-5 Asset State Projection

Date: 2026-06-15

## Status

Accepted

## Context

GIS-5 dựng projection `network_asset_states` để bbox query trả `lifecycleStatus`.
Ba câu hỏi cần chốt: (1) seed trạng thái khởi tạo thế nào, (2) chống event sai
thứ tự ra sao, (3) lấy `tenant_id` ở đâu khi payload `asset.status.changed`
không có tenant và envelope tenant null cho event publish qua outbox.

## Decision

1. **Seed từ `asset.registered` + cập nhật bằng `asset.status.changed`.** Registration
   chỉ emit `asset.registered` (Status="Active"), KHÔNG emit `status.changed` →
   phải seed để projection không rỗng cho asset chưa transition. KHÔNG subscribe
   `asset.decommissioned` (redundant: `status.changed` đã mang newStatus="Decommissioned").

2. **OccurredAt ordering guard.** Upsert chỉ đè khi
   `excluded.updated_at >= network_asset_states.updated_at`. Inbox chỉ chặn
   redelivery trùng eventId; guard chống regress khi 2 event KHÁC nhau tới sai thứ tự.

3. **Tenant derive từ bảng GIS cục bộ.** `envelope.TenantId` = null cho event publish
   qua outbox (xác nhận ở `MassTransitIntegrationEventPublisher` — ambient tenant null
   trong OutboxProcessor scope); `AssetStatusChangedV1` cũng không có tenant. Vì
   `asset_id == GIS asset id` (decision #2) và asset sinh TỪ GIS event (row GIS luôn
   tồn tại trước), consumer `SELECT tenant_id FROM network_{nodes|pipes|devices}
   WHERE id = @assetId` (bảng theo `Data.AssetType`).

4. **Promote `IdempotentEnvelopeConsumer` base class** lên building-blocks (filter
   EventType + inbox dedup + core broker-free). Refactor cả asset-be + gis-be.

## Consequences

- Projection rỗng → bbox trả `lifecycleStatus: null` (hợp US-P1-06) chỉ khi chưa nhận
  event nào cho asset đó; sau seed registered là có giá trị.
- gis-be lần đầu là consumer side → dùng bảng `processed_events` (inbox) đã có sẵn.
- gis Infrastructure phụ thuộc `WaterNetwork.Asset.Contracts` (consumer ref producer
  contract — đối xứng asset→gis ở AST-1).
- Consumer chuẩn hóa `OccurredAt` về UTC Kind trước khi ghi timestamptz (Npgsql yêu cầu).

## Follow-ups

- `tenant_id` trong projection hiện chỉ phục vụ hygiene + index; bbox join đúng nhờ
  asset_id (UUID) duy nhất. Nếu sau cần query projection độc lập theo tenant, index
  đã sẵn.
- Khi consumer thứ 3 cần `IsUniqueViolation` (PG 23505), promote helper lên
  building-blocks (vẫn copy ở asset-be).
