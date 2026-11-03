# 0011 AST-1 Integration Event Consume Convention

Date: 2026-06-15

## Status

Accepted

## Context

`water-network-asset-be` là service đầu tiên trong platform đóng vai trò **consumer** integration
event (không phải producer). Thực tế trên dây: `MassTransitIntegrationEventPublisher` publish
**một CLR type duy nhất** là `IntegrationEventEnvelope` lên một exchange platform duy nhất (xem
remarks trong `IntegrationEventEnvelope.cs`). Envelope chứa:

- `EventType` — chuỗi định danh loại sự kiện (dùng để route / filter).
- `Payload` — JSON của concrete integration event theo dạng `{ …, Data: <V1 record> }`, trong đó
  `Data` chính là record được publish bởi producer (vd `NetworkNodeRegisteredV1`).
- Tenant fields (`TenantId`, `OrganizationId`, `BranchId`) trong envelope — **null** khi outbox publish vì không có
  HTTP request context (xem remarks trong `MassTransitIntegrationEventPublisher`).

Do `IntegrationEventEnvelope` **không implement** `IIntegrationEvent`, cơ chế
`IdempotentIntegrationEventConsumer<T>` đang có trong building-blocks **không áp dụng được** cho
consumer kiểu này — `T` phải là `IIntegrationEvent` và nhận thẳng typed message từ broker.

Ngoài ra, vì asset-be nhận **toàn bộ** event của platform từ một exchange, consumer phải tự filter
theo `EventType` để chỉ xử lý những event nó quan tâm.

## Decision

Mọi consumer trong platform nhận `IntegrationEventEnvelope` phải tuân theo convention sau:

1. **Subscribe** `IConsumer<IntegrationEventEnvelope>` — không subscribe typed `IConsumer<T>` khi
   T là concrete integration event.
2. **Filter** theo `envelope.EventType`; trả về ngay (no-op) nếu loại event không thuộc danh sách
   đăng ký. Consumer nhận mọi event từ exchange nhưng chỉ xử lý event của mình.
3. **Deserialize** `envelope.Payload` → đọc phần tử `Data` → deserialize thành V1 record của
   **producer** (vd `NetworkNodeRegisteredV1` từ `WaterNetwork.Gis.Contracts`). Không dùng trường
   tenant từ envelope (có thể null) — đọc `TenantId` từ `Data` của payload.
4. **Dedup** theo `envelope.EventId` qua `IInboxMessageStore` với consumer-name cố định (vd
   `"asset.gis-registration"`). Gọi `HasBeenProcessedAsync` trước khi xử lý; gọi
   `MarkAsProcessedAsync` sau khi thành công.
5. **Tái dùng id của producer** làm khóa chính cục bộ (vd `assetId` = GIS node/pipe/device id).
   Đây là nguồn idempotency tự nhiên: event deliver lại → insert trùng PK → bắt unique-violation
   → coi là thành công (xem quy tắc idempotency bên dưới).
6. **Expose một core method** broker-free (vd `HandleEnvelopeAsync`) nhận `IntegrationEventEnvelope`
   để test deterministic không cần MassTransit.
7. **Phụ thuộc cross-service**: consumer chỉ được tham chiếu assembly `*.Contracts` của producer
   (vd `WaterNetwork.Gis.Contracts`) — **không bao giờ** tham chiếu `*.Domain` hay
   `*.Infrastructure` của producer.

### Quy tắc idempotency / conflict semantics

- **Unique-violation trên PK (same id)**: coi là idempotent success — asset đã được tạo bởi lần
  deliver trước (hoặc concurrent race), không có dữ liệu nào bị mất.
- **Unique-violation trên secondary unique key (`(tenant_id, asset_code)`)**: **rethrow** — đây là
  xung đột nghiệp vụ thật (asset khác trùng code trong cùng tenant), cần surface ra retry/dead-letter
  thay vì bị bỏ qua âm thầm.

Lưu ý: asset-be gộp node/pipe/device vào một bảng `network_assets` duy nhất với global unique index
`(tenant_id, asset_code)`, trong khi GIS enforce uniqueness của asset_code per-type trên các bảng
riêng. Do đó xung đột asset_code chéo loại trong cùng tenant là có thể xảy ra và nay được surface
rõ ràng.

## Consequences

- `GisAssetRegistrationConsumer` là consumer đầu tiên theo convention này; các consumer tiếp theo
  (GIS-5 projection consuming `asset.status.changed`, topology-rs, …) phải follow cùng pattern.
- Consumer không tham chiếu domain/infrastructure của producer → ranh giới service rõ ràng, deploy
  độc lập, contract-test là cầu nối duy nhất.
- Tenant phải luôn có trong `Data` của payload — producer có trách nhiệm đưa tenant vào V1 record
  (đã đúng với các GIS V1 contracts hiện tại).

## Follow-ups (ghi nhận tường minh)

1. **Promote `IdempotentEnvelopeConsumer` base class** lên building-blocks khi consumer thứ 2 xuất
   hiện (GIS-5 projection consuming `asset.status.changed`). Tránh copy-paste pattern filter +
   dedup + core-method vào mọi consumer.
2. **Promote `IsUniqueViolation` (PG 23505) lên `PostgresExceptionHelper` chung** trong
   building-blocks khi service thứ 2 cần (GIS đã có trong Application layer; asset-be có bản
   local copy trong consumer). Trigger: consumer hoặc handler thứ 2 cần check 23505.
3. **Race same-event concurrent (non-blocking)**: trong trường hợp hiếm hai delivery cùng event
   race đến insert đồng thời, unique-violation bị bắt (treat as success), nhưng EF vẫn tracking
   entity đã Added → `MarkAsProcessedAsync` sẽ `SaveChanges` lần 2 và ném 23505 một lần nữa → message
   retry → lần này `HasBeenProcessedAsync` = true → no-op. Không mất dữ liệu; cân nhắc detach
   entity hoặc dùng fresh scope cho inbox write nếu spurious retry gây noise. Non-blocking.
4. **`OutboxPublishPipelineTests` (asset) chưa assert EventId round-trip** (mapper copy EventId
   đúng, e2e deliver-twice dedup cover; thêm assertion tường minh vào AST-2 contract test).
