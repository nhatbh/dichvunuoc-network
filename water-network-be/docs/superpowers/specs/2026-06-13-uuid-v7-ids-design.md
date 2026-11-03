# UUID v7 cho id ghi DB — Design

**Ngày:** 2026-06-13
**Trạng thái:** Approved (brainstorm với user)

## Mục tiêu

Mọi id sinh mới ghi vào DB dùng UUID v7 (RFC 9562, time-ordered) thay cho UUID v4
(random) để PK sort theo thời gian và cải thiện index locality (đặc biệt bảng
outbox, insert liên tục). .NET 10 có sẵn `Guid.CreateVersion7()`.

## Scope — 5 điểm sinh id, giữ nguyên format chuỗi

| # | File | Trước | Sau |
|---|------|-------|-----|
| 1 | `src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Aggregates/NetworkNode.cs` (~39) | `$"node-{Guid.NewGuid():N}"` | `$"node-{Guid.CreateVersion7():N}"` |
| 2 | `src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Aggregates/NetworkPipe.cs` (~65) | `$"pipe-{Guid.NewGuid():N}"` | `$"pipe-{Guid.CreateVersion7():N}"` |
| 3 | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Infrastructure/Outbox/OutboxEntry.cs` (~5) | `Guid.NewGuid().ToString()` | `Guid.CreateVersion7().ToString()` |
| 4 | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Domain/Events/DomainEventBase.cs` (~22) | `Guid.NewGuid().ToString()` | `Guid.CreateVersion7().ToString()` |
| 5 | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Domain/Events/BaseDomainEvent.cs` (~5) | `Guid.NewGuid().ToString()` | `Guid.CreateVersion7().ToString()` |

Ngoài scope: `CorrelationId` (không ghi DB), dữ liệu v4 đã tồn tại (dev/test,
chấp nhận mixed ordering — time-order chỉ đúng từ thời điểm chuyển đổi).

## Quyết định đã chốt

- **Approach A — swap tại chỗ**, không thêm helper tập trung vào building-blocks
  (YAGNI; pattern dự án là mirror slice trước, GIS-2 sẽ copy dòng v7; nâng cấp
  helper sau nếu lặp nhiều).
- Format chuỗi không đổi: `{prefix}-{:N}` cho aggregate, dạng có gạch ngang ("D")
  cho outbox/event id. Cả hai format đều sort đúng theo text vì timestamp nằm ở
  các hex đầu.
- Không đổi schema/migration/API contract. Không cần decision record (không đổi
  contract/architecture).

## Ràng buộc kỹ thuật

- UUID v7 time-order chính xác đến **millisecond**; trong cùng 1ms thứ tự không
  đảm bảo (phần sau timestamp là random). Đủ cho mục đích sort/index locality.
- `Guid.ToString()`/`:N` của .NET render đúng thứ tự byte RFC nên lexicographic
  string order = time order.

## Test (TDD)

- **GIS UnitTests** (`NetworkNodeTests`/`NetworkPipeTests`): id từ `Register` có
  version nibble = 7 (ký tự hex thứ 13 của phần guid == '7'); 2 lần `Register`
  cách nhau ≥ 2ms → id sort tăng dần (string compare phần sau prefix).
- **Building-blocks tests**: `OutboxEntry.Id` và `EventId` (cả 2 base class) là
  UUID v7 hợp lệ và sort theo thời gian tương tự.

## Verify & docs

- Build 2 solution 0 warning; test per-project (KHÔNG dùng `dotnet test *.slnx`
  — SDK 10.0.107 silently chạy 0 test).
- Thêm 1 dòng convention vào `docs/conventions/template-mapping.md`: id generation
  dùng `Guid.CreateVersion7()`, GIS-2 mirror theo.
- 1 conventional commit duy nhất.
