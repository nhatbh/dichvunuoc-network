# Phase 1 — GIS-1 RegisterPipe (US-P1-02) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slice end-to-end `RegisterPipe` trên `water-network-gis-be`: command → aggregate `NetworkPipe` → persistence PostGIS (LineString 4326) → domain event `PipeRegistered` → outbox → integration event `network.pipe.registered` v1 → endpoint `POST /api/network/pipes` + `GET /api/network/pipes/{id}` → 3 tầng test xanh.

**Pattern gốc:** mirror slice RegisterNode hiện có — mọi file mới đặt cạnh file node tương ứng, cùng namespace convention. KHÔNG sửa hành vi node trừ khi task yêu cầu.

**Roadmap tham chiếu:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §4 (domain model, migration M2, API & contract, rủi ro).

---

## Quy ước & quyết định chốt cho slice này

- Thư mục gốc service: `src/services/water-network-gis-be/` (gọi tắt **GIS**); mọi đường dẫn tương đối tính từ repo root.
- **Route**: `/api/network/pipes` — theo convention code hiện có (`NodesEndpointModule` dùng `/api/network/nodes`), KHÔNG theo `/api/v1/gis/...` trong roadmap §4.4. (Việc thống nhất versioning prefix toàn platform là quyết định cross-cutting, để ngỏ — ghi chú vào backlog nếu chưa có.)
- **Id format**: `pipe-{Guid.NewGuid():N}` (mirror `node-…`).
- **LengthM**: luôn tính server-side bằng `ST_Length(geography(geometry))` (mét) qua port `IPipeLengthCalculator` (impl Dapper/Npgsql). Client gửi `lengthM` tùy chọn: nếu gửi và lệch >10% so với giá trị tính → lưu giá trị client + cột `length_validation_warning` (text, null) ghi cảnh báo; nếu không gửi → lưu giá trị tính, warning null.
- **Material catalog** (VO `PipeMaterial`, parse-first): `HDPE, PVC, DuctileIron, Steel, CastIron, Concrete` — sai danh mục → `DomainException("PipeMaterial.Invalid", …)`.
- Mọi `dotnet test` chạy từ `src/services/water-network-gis-be/` với `WaterNetwork.Gis.slnx`. Yêu cầu kết thúc mỗi task: build 0 warning (TreatWarningsAsErrors).
- Commit theo conventional commits sau mỗi task, kết thúc bằng `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Bản đồ file mới

```text
src/services/water-network-gis-be/
├── src/
│   ├── WaterNetwork.Gis.Domain/
│   │   ├── ValueObjects/PipeGeometry.cs            (Task 1)
│   │   ├── ValueObjects/Diameter.cs                (Task 1)
│   │   ├── ValueObjects/PipeMaterial.cs            (Task 1)
│   │   ├── Aggregates/NetworkPipe.cs               (Task 2)
│   │   ├── DomainEvents/PipeRegistered.cs          (Task 2)
│   │   └── Repositories/INetworkPipeRepository.cs  (Task 2)
│   ├── WaterNetwork.Gis.Application/
│   │   ├── Commands/RegisterPipeCommand.cs         (Task 3)
│   │   ├── Commands/RegisterPipeCommandHandler.cs  (Task 3)
│   │   ├── Validators/RegisterPipeCommandValidator.cs (Task 3)
│   │   ├── Ports/IPipeLengthCalculator.cs          (Task 3)
│   │   ├── Ports/IPipeReadDao.cs                   (Task 6)
│   │   └── Dtos/PipeDetailDto.cs                   (Task 6)
│   ├── WaterNetwork.Gis.Contracts/
│   │   ├── Events/NetworkPipeRegisteredV1.cs       (Task 5)
│   │   ├── Events/GisEventTypes.cs                 (Task 5 — thêm const)
│   │   └── Requests/RegisterPipeRequest.cs         (Task 6)
│   ├── WaterNetwork.Gis.Infrastructure/
│   │   ├── Persistence/NetworkPipePersistenceModel.cs              (Task 4)
│   │   ├── Persistence/Configurations/NetworkPipeConfiguration.cs  (Task 4)
│   │   ├── Persistence/Migrations/…_AddNetworkPipes.cs             (Task 4 — M2)
│   │   ├── Repositories/NetworkPipeRepository.cs                   (Task 4)
│   │   ├── Repositories/PipeLengthCalculator.cs                    (Task 4)
│   │   ├── Repositories/PipeReadDao.cs                             (Task 6)
│   │   └── IntegrationEvents/GisIntegrationEventMapper.cs          (Task 5 — mở rộng)
│   └── WaterNetwork.Gis.Api/
│       ├── Endpoints/PipesEndpointModule.cs        (Task 6)
│       └── Validators/RegisterPipeRequestValidator.cs (Task 6)
└── tests/
    ├── WaterNetwork.Gis.UnitTests/
    │   ├── Domain/PipeGeometryTests.cs, DiameterTests.cs, PipeMaterialTests.cs, NetworkPipeTests.cs
    │   └── Application/RegisterPipeCommandHandlerTests.cs, RegisterPipeCommandValidatorTests.cs
    ├── WaterNetwork.Gis.IntegrationTests/
    │   ├── NetworkPipeRepositoryTests.cs
    │   └── RegisterPipeApiTests.cs
    └── WaterNetwork.Gis.ContractTests/
        └── NetworkPipeRegisteredContractTests.cs
```

---

### Task 1: Value objects `PipeGeometry`, `Diameter`, `PipeMaterial` (TDD)

**Files:** Create VO + test files theo bản đồ trên. Mirror style `GeoPoint.cs` (sealed class : ValueObject, throw `DomainException` với error code dạng `"PipeGeometry.…"`).

- [x] **Step 1: Viết unit tests trước** (`PipeGeometryTests`, `DiameterTests`, `PipeMaterialTests`):
  - `PipeGeometry`: nhận `IReadOnlyList<GeoPoint>`; (a) < 2 điểm → throw `PipeGeometry.TooFewPoints`; (b) 2 điểm trùng hệt nhau → throw `PipeGeometry.DegenerateLine`; (c) hợp lệ → giữ nguyên thứ tự điểm; (d) equality theo toàn bộ points.
  - `Diameter`: (a) ≤ 0 → throw `Diameter.NotPositive`; (b) > 4000 (mm, sanity cap) → throw `Diameter.TooLarge`; (c) hợp lệ giữ value.
  - `PipeMaterial`: (a) parse đúng 6 giá trị catalog (case-insensitive); (b) giá trị lạ → throw `PipeMaterial.Invalid`; (c) `ToString()` trả canonical name.
- [x] **Step 2: Implement 3 VO cho tests xanh.** `PipeGeometry` expose `Points` (`IReadOnlyList<GeoPoint>`); KHÔNG tham chiếu NetTopologySuite trong Domain (NTS chỉ ở Infrastructure, mirror node).
- [x] **Step 3:** `dotnet test` UnitTests xanh, 0 warning → commit `feat(gis): add pipe value objects`.

### Task 2: Aggregate `NetworkPipe` + domain event `PipeRegistered` (TDD)

**Files:** `NetworkPipe.cs`, `PipeRegistered.cs`, `INetworkPipeRepository.cs`, `NetworkPipeTests.cs`. Mirror `NetworkNode`/`NodeRegistered`/`INetworkNodeRepository`.

- [x] **Step 1: Tests trước** (`NetworkPipeTests`):
  - `Register(...)` với `fromNodeId == toNodeId` → throw `DomainException("NetworkPipe.SelfLoop", …)` (bất biến cục bộ của aggregate — không cần I/O).
  - `Register` hợp lệ → Id prefix `pipe-`, raise đúng 1 `PipeRegistered` chứa `{TenantId, AssetCode, FromNodeId, ToNodeId, Points, DiameterMm, Material, LengthM}`.
  - `Reconstitute` không raise event.
  - `SoftDelete()` chưa làm ở slice này (GIS-3) — không viết.
- [x] **Step 2: Implement.** `NetworkPipe : AggregateRoot` fields: `TenantId, AssetCode, FromNodeId, ToNodeId, Geometry (PipeGeometry), DiameterMm (Diameter), Material (PipeMaterial), LengthM (double), LengthValidationWarning (string?), DeletedAt`. Kiểm tra node-tồn-tại KHÔNG nằm trong aggregate (cần I/O — thuộc handler, roadmap §4.2). `INetworkPipeRepository`: `SaveAsync`, `GetByIdAsync`, `ExistsByAssetCodeAsync(tenantId, assetCode)`.
- [x] **Step 3:** Tests xanh → commit `feat(gis): add NetworkPipe aggregate with PipeRegistered event`.

### Task 3: `RegisterPipeCommand` + validator + handler (TDD, mock toàn bộ I/O)

**Files:** command/handler/validator + `IPipeLengthCalculator.cs` + 2 test files. Mirror `RegisterNodeCommand*`.

- [x] **Step 1: Tests trước.**
  - Validator (`RegisterPipeCommandValidatorTests`): assetCode rỗng/quá 64 ký tự; points < 2; lat/lng ngoài range; diameterMm ≤ 0; material rỗng; lengthM âm (khi gửi) — mỗi case 1 test fail message rõ.
  - Handler (`RegisterPipeCommandHandlerTests`, NSubstitute):
    - happy path: 2 node tồn tại → save called, trả id, lengthM lấy từ `IPipeLengthCalculator` khi command không gửi lengthM;
    - `fromNodeId` không tồn tại (repo trả null) → `BusinessRuleException("NetworkPipe.EndpointNotFound", …)` (→ 422);
    - `toNodeId` không tồn tại → tương tự;
    - node tồn tại nhưng `DeletedAt != null` → `EndpointNotFound` (node đã xóa không làm endpoint);
    - duplicate asset code (`ExistsByAssetCodeAsync` true) → `ConflictException` (→ 409, mirror node);
    - client gửi lengthM lệch >10% so với calculator → aggregate lưu lengthM client + warning khác null; lệch ≤10% → warning null.
- [x] **Step 2: Implement.** `RegisterPipeCommand(AssetCode, FromNodeId, ToNodeId, Points: IReadOnlyList<(double Lat, double Lng)>, DiameterMm, Material, LengthM?) : ICommand<string>`; tenant từ `ITenantContext` trong handler (mirror node handler). Handler: validate endpoints qua `INetworkNodeRepository.GetByIdAsync` (2 call), check duplicate, gọi `IPipeLengthCalculator.CalculateMetersAsync(points)`, dựng VO (parse-first), `NetworkPipe.Register(...)`, save.
- [x] **Step 3:** Tests xanh → commit `feat(gis): add RegisterPipe command pipeline`.

### Task 4: Persistence — migration M2 `network_pipes` + repository + length calculator (integration test)

**Files:** persistence model, configuration, migration, `NetworkPipeRepository`, `PipeLengthCalculator`, `NetworkPipeRepositoryTests` (PostgisFixture).

- [x] **Step 1: Integration tests trước** (`NetworkPipeRepositoryTests`, mirror `NetworkNodeRepositoryTests`):
  - save → get round-trip giữ nguyên geometry (so từng điểm), diameter, material, lengthM, warning;
  - unique `(tenant_id, asset_code)` → save trùng ném `ConflictException` (bắt `UniqueViolation`, mirror node);
  - optimistic concurrency: save với version cũ → `ConcurrencyException`;
  - tenant isolation: pipe tenant A không đọc được khi query tenant B (nếu pattern node có — mirror);
  - `PipeLengthCalculator`: LineString thật dài ~100m (2 điểm cách nhau ~0.0009° lat tại xích đạo) → kết quả trong khoảng [99, 101] m (rủi ro §4.6: geography, không phải degree).
- [x] **Step 2: Implement.**
  - `NetworkPipePersistenceModel`: `Id, TenantId, AssetCode, FromNodeId, ToNodeId, Geometry (NTS LineString), DiameterMm (int), Material (string), LengthM (double), LengthValidationWarning (string?), Status (string, default "Active"), Version, CreatedAt, UpdatedAt, DeletedAt`.
  - `NetworkPipeConfiguration`: table `network_pipes`, snake_case columns, `geometry(LineString,4326)`, unique `ux_network_pipes_tenant_asset_code (tenant_id, asset_code)`, GiST `ix_network_pipes_geometry_gist`, btree `ix_network_pipes_from_to (tenant_id, from_node_id, to_node_id)` (roadmap M2), `Version` IsConcurrencyToken, query filter `DeletedAt == null`.
  - `NetworkPipeRepository : AggregateRepositoryBase<NetworkPipe>` — mirror node repo (PersistAsync với version check, ToModel/ToDomain, GeoPoint↔Coordinate: **lưu ý thứ tự (lng, lat)** = `(X, Y)` như `ToPoint` của node).
  - `PipeLengthCalculator` (Infrastructure): Dapper trên connection của `GisDbContext`: `SELECT ST_Length(ST_GeogFromWKB(@wkb))` hoặc `ST_Length(geography(ST_GeomFromText(@wkt, 4326)))`.
  - Migration: `dotnet ef migrations add AddNetworkPipes` từ project Infrastructure (DesignTimeFactory đã có).
- [x] **Step 3:** Đăng ký DI mới trong `Program.cs` (repo, calculator). Integration tests xanh → commit `feat(gis): persist network pipes with PostGIS LineString`.

### Task 5: Contract — `network.pipe.registered` v1 (contract test trước)

**Files:** `NetworkPipeRegisteredV1.cs`, `GisEventTypes.cs` (thêm `PipeRegistered = "network.pipe.registered"`), mở rộng `GisIntegrationEventMapper`, `NetworkPipeRegisteredContractTests`.

- [x] **Step 1: Contract tests trước** (mirror `NetworkNodeRegisteredContractTests`):
  - payload schema cố định: `PipeId, TenantId, AssetCode, FromNodeId, ToNodeId, LengthM, DiameterMm, Material` (roadmap §4.4 — geometry KHÔNG vào event, consumer cần geometry thì query/snapshot);
  - `GisEventTypes.PipeRegistered == "network.pipe.registered"`, version 1;
  - mapper translate `PipeRegistered` domain event → integration event đúng type/version/sourceAggregate;
  - mapper vẫn trả null cho event lạ và **vẫn map NodeRegistered đúng** (regression — mapper giờ map 2 loại).
- [x] **Step 2: Implement.** `CanMap` chấp nhận cả `"NodeRegistered"` và `"PipeRegistered"`; thêm `PipeRegisteredIntegrationEvent` record.
- [x] **Step 3:** ContractTests xanh → commit `feat(gis): publish network.pipe.registered v1 contract`.

### Task 6: API — `POST /api/network/pipes`, `GET /api/network/pipes/{id}` + E2E

**Files:** `RegisterPipeRequest`, `RegisterPipeRequestValidator`, `PipesEndpointModule`, `IPipeReadDao` + `PipeReadDao` (Dapper) + `PipeDetailDto` + `GetPipeDetailQuery(+Handler)`, `RegisterPipeApiTests`. Mirror module node (`WithValidation`, `RequirePermission("network-gis:write"/"read")`).

- [x] **Step 1: E2E tests trước** (`RegisterPipeApiTests` qua `GisApiFactory` — seed 2 node trước bằng POST nodes):
  - happy: POST → 201 + Location + id prefix `pipe-`; GET trả đủ field (kể cả lengthM tính từ geometry khi không gửi);
  - endpoint thiếu (fromNodeId không tồn tại) → 422 ProblemDetails code `NetworkPipe.EndpointNotFound`;
  - self-loop (from == to) → 400 `DOMAIN_RULE` (`NetworkPipe.SelfLoop` là `DomainException` — bất biến cục bộ theo Task 2 Step 1; 422 chỉ dành cho `BusinessRuleException` cần I/O. Sửa từ "422" gốc — plan tự mâu thuẫn với định nghĩa aggregate);
  - geometry sai (1 điểm; lat=99) → 400 validation;
  - diameterMm ≤ 0 → 400;
  - material lạ → 400 (validator chặn trước handler);
  - duplicate asset code → 409;
  - outbox: sau POST thành công, bảng outbox có message type `network.pipe.registered` (mirror cách RegisterNodeApiTests assert — nếu node test không assert outbox thì thêm cho cả slice này, không sửa test node).
- [x] **Step 2: Implement.** `PipeDetailDto` trả geometry dạng `points: [{lat,lng}]`. `PipeReadDao` Dapper: `select … , ST_Y/ST_X unnest điểm` hoặc đọc WKT rồi parse — chọn cách đơn giản nhất, KHÔNG kéo EF vào read side.
- [x] **Step 3:** Toàn bộ `dotnet test WaterNetwork.Gis.slnx` xanh (cả test node cũ), 0 warning → commit `feat(gis): expose pipe registration API (US-P1-02)`. (Lưu ý: `dotnet test <slnx>` trên SDK 10.0.107 silently chạy 0 test — phải chạy test theo từng project; build slnx vẫn dùng để check 0 warning.)

### Task 7: Chốt sổ slice

- [x] Chạy full test 2 solution (`WaterPlatform.BuildingBlocks.slnx` + `WaterNetwork.Gis.slnx`) — tổng ≥ 138 + tests mới, tất cả xanh.
- [x] Cập nhật `docs/conventions/template-mapping.md` nếu slice sinh pattern mới (ứng viên: VO list-of-points, length calculator port, mapper đa event).
- [x] Cập nhật `docs/stories/backlog.md`: Phase 1 → `in progress (GIS-1 done)`.
- [x] Commit cuối + ghi chú follow-up cho GIS-2 InstallDevice (slice kế tiếp theo roadmap §4.5).

## Rủi ro & lưu ý (từ roadmap §4.6)

- `ST_Length` phải trên **geography** (mét), không geometry (độ) — đã có test ~100m sai số <1% chốt chặn.
- Race duplicate asset code: unique constraint là chốt cuối; handler bắt `UniqueViolation` → 409 (pattern node có sẵn).
- Thứ tự tọa độ NTS: `Coordinate(X=lng, Y=lat)` — dễ đảo ngược; round-trip test ở Task 4 chốt chặn.
- Mapper từ 1-event sang multi-event: giữ `CanMap` đơn giản (switch theo eventType); nếu thấy if-chain dài ở GIS-2 thì refactor sang registry — chưa làm bây giờ.
