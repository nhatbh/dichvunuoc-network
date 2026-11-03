# GIS-2 InstallDevice (US-P1-03) — Design

**Status:** approved (brainstorm 2026-06-13)
**Service:** `water-network-gis-be`
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §4.2–4.6
**Pattern gốc:** mirror slice GIS-1 RegisterPipe (`docs/superpowers/plans/2026-06-13-phase1-gis1-register-pipe.md`)

## Scope

Slice end-to-end `InstallDevice`: command → aggregate `NetworkDevice` → persistence
PostGIS (Point 4326, migration M3) → domain event `DeviceInstalled` → outbox →
integration event `network.device.installed` v1 → endpoint
`POST /api/network/devices` + `GET /api/network/devices/{id}` → 3 tầng test xanh.

Gộp vào slice (đã chốt khi brainstorm):

1. **Refactor `GisIntegrationEventMapper` sang registry** —
   `Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>>`. `DeviceInstalled`
   là event thứ 3, đúng điều kiện follow-up trong backlog + template-mapping §7.3.
2. **Decision record API route prefix** — chốt giữ `/api/network/...` (không
   `/api/v1/`); versioning là việc của YARP gateway (US-X). Đóng follow-up backlog.

Ngoài scope: check khoảng cách location↔host geometry (YAGNI — roadmap chỉ yêu cầu
host tồn tại); soft-delete/remove device (GIS-3); bbox query (GIS-4).

## Quyết định chốt

| # | Quyết định | Chọn |
|---|---|---|
| 1 | Route prefix | `/api/network/devices`, chốt bằng decision record — versioning thuộc gateway |
| 2 | Host thừa (vd Valve kèm hostNodeId; PressureSensor gửi cả hai) | **Strict reject** — không silently ignore |
| 3 | Vị trí logic host rules | VO `DeviceHost` trong Domain (400); handler chỉ check host tồn tại qua repository (422) |
| 4 | Mapper if-chain | Refactor registry ngay trong slice này |

## Domain

### Value objects

- **`DeviceType`** — parse-first, case-insensitive, canonical
  `{Valve, FlowMeter, PressureSensor, Pump, Hydrant}`; giá trị lạ →
  `DomainException("DeviceType.Invalid")`. Mirror `PipeMaterial`.
- **`DeviceHost`** — nhận `(DeviceType, string? hostPipeId, string? hostNodeId)`,
  enforce strict matrix:

  | DeviceType | hostPipeId | hostNodeId |
  |---|---|---|
  | Valve, FlowMeter | bắt buộc | cấm |
  | Pump, Hydrant | cấm | bắt buộc |
  | PressureSensor | đúng một trong hai (XOR) | |

  Error codes (`DomainException` → 400): `DeviceHost.HostRequired` (thiếu host
  bắt buộc), `DeviceHost.HostNotAllowed` (gửi host không thuộc tập cho phép),
  `DeviceHost.AmbiguousHost` (PressureSensor gửi cả hai).
- **Location** — dùng lại `GeoPoint` có sẵn.

### Aggregate `NetworkDevice`

- Id prefix `device-` (generator uuid v7 hiện hành, mirror `pipe-`).
- Fields: `TenantId, AssetCode (AssetCode), DeviceType, Host (DeviceHost),
  Location (GeoPoint), DeletedAt`.
- `Install(...)` raise đúng 1 `DeviceInstalled
  {TenantId, AssetCode, DeviceType, HostPipeId?, HostNodeId?, Latitude, Longitude}`;
  `Reconstitute` không raise event.
- `INetworkDeviceRepository`: `SaveAsync`, `GetByIdAsync`,
  `ExistsByAssetCodeAsync(tenantId, assetCode)`.

## Application

- `InstallDeviceCommand(AssetCode, DeviceType, HostPipeId?, HostNodeId?, Lat, Lng)
  : ICommand<string>`; tenant từ `ITenantContext` (mirror pipe handler).
- Validator (FluentValidation): assetCode rỗng/quá 64; deviceType rỗng; lat/lng
  ngoài range. Host rules KHÔNG lặp ở validator — thuộc VO domain.
- Handler:
  1. Parse VO (parse-first) — `DeviceHost` chặn shape sai → 400.
  2. Check host tồn tại + `DeletedAt == null` qua `INetworkPipeRepository` /
     `INetworkNodeRepository` (chỉ check ref mà `DeviceHost` giữ) → thiếu →
     `BusinessRuleException("NetworkDevice.HostNotFound")` (422).
  3. Duplicate asset code (`ExistsByAssetCodeAsync`) → `ConflictException` (409);
     unique constraint là chốt cuối (race → bắt `UniqueViolation` trong repo,
     pattern node/pipe sẵn có).
  4. `NetworkDevice.Install(...)` → save.

## Infrastructure

- **Migration M3 `network_devices`**: mirror cột chuẩn `network_pipes`
  (`id text pk, tenant_id, asset_code, status default 'Active', row_version,
  created_at, updated_at, deleted_at`) + `device_type text not null`,
  `host_pipe_id text null`, `host_node_id text null`,
  `location geometry(Point, 4326) not null`.
  - Unique `ux_network_devices_tenant_asset_code (tenant_id, asset_code)`
  - GiST `ix_network_devices_location_gist (location)`
  - Btree `ix_network_devices_host_pipe (tenant_id, host_pipe_id)`,
    `ix_network_devices_host_node (tenant_id, host_node_id)` — phục vụ rule kiểu
    `NodeHasAttachedDevices` ở GIS-3.
- `NetworkDevicePersistenceModel` + `NetworkDeviceConfiguration` (query filter
  `DeletedAt == null`, `Version` concurrency token — mirror pipe).
- `NetworkDeviceRepository : AggregateRepositoryBase<NetworkDevice>` —
  GeoPoint↔NTS `Point(X=lng, Y=lat)`; NTS chỉ ở Infrastructure.
- **Mapper registry**: `GisIntegrationEventMapper` chuyển `CanMap`/`Map` sang
  `Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>>` keyed theo domain
  event type name; cập nhật template-mapping §7.3 sau refactor.

## Contracts & API

- `NetworkDeviceInstalledV1 {DeviceId, TenantId, AssetCode, DeviceType,
  HostPipeId?, HostNodeId?, Latitude, Longitude}`;
  `GisEventTypes.DeviceInstalled = "network.device.installed"`, version 1.
  (Location vào event — 1 điểm là rẻ, khác pipe geometry bị loại.)
- `POST /api/network/devices` → 201 + Location header + `{id}`;
  `InstallDeviceRequest` + validator đăng ký API-assembly (template-mapping §7.4);
  permission `network-gis:write`.
- `GET /api/network/devices/{id}` → `DeviceDetailDto` (đủ field, location dạng
  `{lat,lng}`) qua `IDeviceReadDao` + `DeviceReadDao` Dapper (không EF read side);
  permission `network-gis:read`.

## Testing

- **Unit**: `DeviceTypeTests`; `DeviceHostTests` matrix 5 type × {host đúng,
  thiếu, thừa} + PressureSensor cả-hai (~15 case); `NetworkDeviceTests`
  (Install raise event, Reconstitute không); handler tests (NSubstitute — happy
  theo host pipe lẫn host node, host không tồn tại 422, host soft-deleted 422,
  duplicate 409); validator tests.
- **Integration** (PostgisFixture): save→get round-trip (point, host refs, type);
  unique → `ConflictException`; optimistic concurrency; tenant isolation.
- **E2E** (`GisApiFactory`, seed node + pipe trước): happy Valve-trên-pipe,
  Pump-trên-node, PressureSensor cả 2 biến thể; host không tồn tại → 422
  `NetworkDevice.HostNotFound`; sai host rule (Valve thiếu pipe, Valve kèm node,
  PressureSensor cả hai) → 400 `DOMAIN_RULE`; lat=99 → 400 validation;
  duplicate asset code → 409; outbox có message `network.device.installed`.
  (Case host đã soft-delete → 422 chỉ test được ở unit level — chưa có remove
  endpoint cho tới GIS-3 nên E2E không seed được host deleted.)
- **Contract**: schema v1 cố định; type/version/sourceAggregate; regression
  NodeRegistered + PipeRegistered vẫn map đúng qua registry mới; event lạ → null.

## Docs & chốt sổ

- Decision record `docs/decisions/0009-api-route-prefix.md`.
- Update `docs/conventions/template-mapping.md` §7.3 (mapper registry).
- `docs/stories/backlog.md`: đóng 2 follow-up (mapper registry, versioning
  prefix); giữ ghi chú `dotnet test <slnx>` footgun.
- Kết thúc: `dotnet test` từng test project xanh, 0 warning
  (TreatWarningsAsErrors), conventional commits.
