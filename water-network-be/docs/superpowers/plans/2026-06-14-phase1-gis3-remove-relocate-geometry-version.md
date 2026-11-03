# Phase 1 — GIS-3 Remove + Relocate + GeometryVersion (catalog §5.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD bắt buộc: viết test → xác nhận FAIL → implement → xác nhận PASS → commit.

**Goal:** Hoàn thiện vòng đời geometry của GIS core trên `water-network-gis-be`:
(a) **soft-delete (remove)** node/pipe/device với rule chặn tham chiếu sống;
(b) **relocate** node + audit **GeometryVersion** append-only;
(c) 4 integration event mới qua registry; (d) endpoints DELETE/PATCH/geometry-history;
(e) đóng 2 follow-up backlog (pipe unique-violation backstop, device/pipe update-path test).

**Architecture:** Mirror GIS-1/GIS-2 từng file. Bất biến cục bộ (no-op relocate, append-only version)
nằm trong Domain (`DomainException` → 400). Rule cần I/O (node còn pipe/device nối tới) nằm trong
**handler** qua repository (`BusinessRuleException` → 422). NTS chỉ ở Infrastructure; Domain giữ
geometry dạng GeoJSON string. KHÔNG sửa hành vi register hiện có trừ: (1) RegisterNode append
GeometryVersion v1 (Task 3), (2) RegisterPipe thêm backstop unique-violation (Task 8).

**Tech Stack:** .NET 10, EF Core + NetTopologySuite (write), Dapper (read), PostGIS, FluentValidation,
xUnit + FluentAssertions + NSubstitute, Testcontainers (PostgisFixture).

**Spec:** `docs/superpowers/specs/2026-06-14-gis3-remove-relocate-geometry-version-design.md`

---

## Quy ước & quyết định chốt cho slice này

- Thư mục gốc service: `src/services/water-network-gis-be/` (gọi tắt **GIS**); mọi đường dẫn tương
  đối tính từ đó trừ khi ghi rõ repo root.
- **Route**: `/api/network/...` (decision 0009 — không tự version, versioning thuộc YARP gateway).
- **Tên event xóa**: giữ `NodeDeleted` → `network.node.deleted` (domain event đã tồn tại); pipe/device
  tương tự `network.pipe.deleted` / `network.device.deleted`. Roadmap §4.4 ghi "removed" — slice này
  chốt "deleted" để khỏi churn, cập nhật roadmap ở Task 9.
- **Rule chặn remove** (ở handler, qua repository — KHÔNG ở aggregate vì cần I/O):

  | Lệnh | Chặn khi | Code (422) |
  |---|---|---|
  | RemoveNode | còn pipe **chưa xóa** có endpoint = node | `NetworkNode.HasConnectedPipes` |
  | RemoveNode | còn device **chưa xóa** host = node | `NetworkNode.HasAttachedDevices` |
  | RemovePipe | còn device **chưa xóa** host = pipe | `NetworkPipe.HasAttachedDevices` |
  | RemoveDevice | — (không rule) | — |

- **GeometryVersion** phạm vi node-only: append **v1 khi RegisterNode**, **v(n+1) khi RelocateNode**.
  Pipe/device geometry version defer (chưa có reroute). Lưu geometry dạng GeoJSON string trong Domain;
  cột DB `geometry(Geometry,4326)` + `geojson text`, **không GiST**.
- **404 vs idempotent**: DELETE/PATCH id không tồn tại (hoặc đã soft-deleted → query filter ẩn) → 404
  `NotFoundException`. Vướng rule → 422.
- **Relocate no-op**: vị trí mới == vị trí cũ → `DomainException("NetworkNode.NoLocationChange")` (400).
- **Tenant check trên endpoint/host refs**: KHÔNG làm ở slice này (mirror GIS-1/2) — follow-up backlog.
- `dotnet test` chạy **từng test project** (SDK 10.0.107 silently chạy 0 test với `.slnx`); build
  `WaterNetwork.Gis.slnx` để check 0 warning (TreatWarningsAsErrors).
- Commit conventional sau mỗi task, kết thúc `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Trạng thái khởi điểm (đã verify trong code — không giả định lại)

- `NetworkNode`: **đã có** `DeletedAt`, `SoftDelete()`, `NodeDeleted`/`NodeDeletedData`;
  `NetworkNodeRepository.DeleteAsync` đã soft-delete. **Chưa** có mapper entry, contract
  `NetworkNodeDeletedV1`, command/handler/endpoint, rule chặn.
- `NetworkPipe`, `NetworkDevice`: có `DeletedAt` + `Reconstitute(deletedAt)`; **chưa** có
  `SoftDelete()`/`*Deleted` event; repo `DeleteAsync` ném `NotSupportedException("…until GIS-3")`.
- 3 persistence model đã có cột `deleted_at` + `HasQueryFilter(DeletedAt == null)` → **không cần
  migration cột delete**; M4 chỉ cho `geometry_versions`.
- Mapper đã là registry; chỉ thêm key. `GisEventTypes` có 3 const.
- Migrations hiện có: `20260611101310_InitialCreate`, `20260612233035_AddNetworkPipes`,
  `20260613042105_AddNetworkDevices`. M4 mới = `AddGeometryVersions`.

> **Lưu ý mirror:** mọi đoạn code dưới là khung tham chiếu. Trước khi implement mỗi file, mở file
> mẫu tương ứng (đã ghi tên) để lấy đúng chữ ký base class / tên thành viên thật, rồi khớp. Nếu chữ
> ký lệch, sửa phần dựng/khung — **giữ nguyên assertions của test**.

## Bản đồ file mới / sửa

```text
src/services/water-network-gis-be/
├── src/
│   ├── WaterNetwork.Gis.Domain/
│   │   ├── ValueObjects/AssetKind.cs                         (Task 1)
│   │   ├── Entities/GeometryVersion.cs                       (Task 1)
│   │   ├── Repositories/IGeometryVersionStore.cs            (Task 1)
│   │   ├── Aggregates/NetworkNode.cs                         (Task 2 — thêm Relocate)
│   │   ├── Aggregates/NetworkPipe.cs                         (Task 4 — thêm SoftDelete)
│   │   ├── Aggregates/NetworkDevice.cs                       (Task 4 — thêm SoftDelete)
│   │   └── DomainEvents/NodeRelocated.cs, PipeDeleted.cs, DeviceDeleted.cs   (Task 2/4)
│   ├── WaterNetwork.Gis.Application/
│   │   ├── Commands/RelocateNodeCommand(+Handler).cs        (Task 3)
│   │   ├── Commands/RemoveNodeCommand(+Handler).cs          (Task 5)
│   │   ├── Commands/RemovePipeCommand(+Handler).cs          (Task 5)
│   │   ├── Commands/RemoveDeviceCommand(+Handler).cs        (Task 5)
│   │   ├── Validators/RelocateNodeCommandValidator.cs       (Task 3)
│   │   ├── Ports/IGeometryVersionReadDao.cs                 (Task 7)
│   │   ├── Dtos/GeometryVersionDto.cs                       (Task 7)
│   │   └── Queries/GetNodeGeometryHistoryQuery(+Handler).cs (Task 7)
│   ├── WaterNetwork.Gis.Contracts/
│   │   ├── Events/NetworkNodeDeletedV1.cs, NetworkPipeDeletedV1.cs,
│   │   │          NetworkDeviceDeletedV1.cs, NetworkNodeRelocatedV1.cs        (Task 6)
│   │   ├── Events/GisEventTypes.cs                          (Task 6 — thêm const)
│   │   └── Requests/RelocateNodeRequest.cs                  (Task 7)
│   ├── WaterNetwork.Gis.Infrastructure/
│   │   ├── Persistence/GeometryVersionPersistenceModel.cs + Configuration       (Task 1)
│   │   ├── Persistence/GisDbContext.cs                      (Task 1 — DbSet)
│   │   ├── Persistence/Migrations/…_AddGeometryVersions.cs  (Task 1 — M4)
│   │   ├── Repositories/GeometryVersionStore.cs             (Task 1)
│   │   ├── Repositories/GeometryVersionReadDao.cs           (Task 7)
│   │   ├── Repositories/NetworkPipeRepository.cs            (Task 5 — DeleteAsync + ExistsByEndpointNode; Task 8 backstop)
│   │   ├── Repositories/NetworkDeviceRepository.cs          (Task 5 — DeleteAsync + ExistsByHost*)
│   │   └── IntegrationEvents/GisIntegrationEventMapper.cs   (Task 6 — +4 entry)
│   └── WaterNetwork.Gis.Api/
│       ├── Endpoints/NodesEndpointModule.cs                 (Task 7 — DELETE + PATCH + history)
│       ├── Endpoints/PipesEndpointModule.cs                 (Task 7 — DELETE)
│       ├── Endpoints/DevicesEndpointModule.cs               (Task 7 — DELETE)
│       ├── Validators/RelocateNodeRequestValidator.cs       (Task 7)
│       └── Program.cs                                       (Task 1/3/5/7 — DI)
└── tests/
    ├── WaterNetwork.Gis.UnitTests/        (Domain + Application — Task 1..5)
    ├── WaterNetwork.Gis.IntegrationTests/ (geometry version store, repo soft-delete, exists* — Task 1/5/8)
    └── WaterNetwork.Gis.ContractTests/    (4 event mới + regression — Task 6)
```

---

## Thứ tự task

1. GeometryVersion foundation (VO `AssetKind`, entity, store, migration M4) — nền cho relocate.
2. `NetworkNode.Relocate` + `NodeRelocated` event (domain TDD).
3. `RelocateNodeCommand` + handler (append version) + hook RegisterNode→v1.
4. `SoftDelete()` + `PipeDeleted`/`DeviceDeleted` cho pipe/device aggregate (domain TDD).
5. Remove commands + handlers + rule chặn + repo `DeleteAsync`/`Exists*` (pipe/device).
6. Contracts + mapper registry (4 event) + contract tests.
7. API endpoints (DELETE × 3, PATCH relocate, geometry-history) + E2E.
8. Backlog follow-ups: pipe unique-violation backstop + device/pipe update-path round-trip test.
9. Docs + decision record + backlog + final verification (full test, 0 warning).

---

### Task 1: GeometryVersion foundation (TDD + migration M4)

**Files:**
- Create: `Domain/ValueObjects/AssetKind.cs`, `Domain/Entities/GeometryVersion.cs`,
  `Domain/Repositories/IGeometryVersionStore.cs`
- Create: `Infrastructure/Persistence/GeometryVersionPersistenceModel.cs` +
  `Configurations/GeometryVersionConfiguration.cs`; modify `GisDbContext.cs` (DbSet)
- Create: `Infrastructure/Repositories/GeometryVersionStore.cs`; migration M4
- Modify: `Api/Program.cs` (DI)
- Test: `UnitTests/Domain/AssetKindTests.cs`, `GeometryVersionTests.cs`;
  `IntegrationTests/GeometryVersionStoreTests.cs`

- [x] **Step 1: Unit tests trước.**

`AssetKindTests` — mirror `NodeTypeTests` (parse-first, case-insensitive, canonical `{Node,Pipe,Device}`;
giá trị lạ → `DomainException("AssetKind.Invalid")`; equality theo canonical).

`GeometryVersionTests`:

```csharp
// - Create gán đúng field (AssetId, AssetKind, Version, GeoJson, ChangedBy, Reason), ChangedAt ~ now.
// - Version < 1 → DomainException("GeometryVersion.InvalidVersion").
// - GeoJson rỗng/whitespace → DomainException("GeometryVersion.EmptyGeometry").
// - Là append-only: không có setter public, không có method mutate (assert bằng compile-shape:
//   chỉ test các getter trả đúng giá trị từ Create).
```

- [x] **Step 2: Chạy test xác nhận FAIL** (compile). Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`

- [x] **Step 3: Implement domain.**

`AssetKind.cs` — mirror `NodeType`/`PipeMaterial` (catalog dict + `Parse` + equality).

`GeometryVersion.cs`:

```csharp
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Domain.Entities;

/// <summary>Append-only audit row for one geometry state of an asset. Never updated or deleted.</summary>
public sealed class GeometryVersion
{
    public string Id { get; }
    public string AssetId { get; }
    public AssetKind AssetKind { get; }
    public int Version { get; }
    public string GeoJson { get; }
    public string? ChangedBy { get; }
    public string? Reason { get; }
    public DateTime ChangedAt { get; }

    private GeometryVersion(string id, string assetId, AssetKind assetKind, int version,
        string geoJson, string? changedBy, string? reason, DateTime changedAt)
    {
        Id = id; AssetId = assetId; AssetKind = assetKind; Version = version;
        GeoJson = geoJson; ChangedBy = changedBy; Reason = reason; ChangedAt = changedAt;
    }

    public static GeometryVersion Create(string assetId, AssetKind assetKind, int version,
        string geoJson, string? changedBy = null, string? reason = null)
    {
        if (version < 1)
            throw new DomainException("GeometryVersion.InvalidVersion", "Version must be >= 1.");
        if (string.IsNullOrWhiteSpace(geoJson))
            throw new DomainException("GeometryVersion.EmptyGeometry", "GeoJson is required.");

        return new GeometryVersion(
            id: $"geomver-{Guid.CreateVersion7():N}",
            assetId: assetId, assetKind: assetKind, version: version,
            geoJson: geoJson, changedBy: changedBy?.Trim(), reason: reason?.Trim(),
            changedAt: DateTime.UtcNow);
    }

    // Reconstitute for read paths if needed by store (no validation).
    public static GeometryVersion Reconstitute(string id, string assetId, AssetKind assetKind,
        int version, string geoJson, string? changedBy, string? reason, DateTime changedAt)
        => new(id, assetId, assetKind, version, geoJson, changedBy, reason, changedAt);
}
```

`IGeometryVersionStore.cs`:

```csharp
using WaterNetwork.Gis.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface IGeometryVersionStore
{
    Task<int> GetNextVersionAsync(string assetId, CancellationToken ct = default);
    Task AppendAsync(GeometryVersion version, CancellationToken ct = default);
    Task<IReadOnlyList<GeometryVersion>> ListByAssetAsync(string assetId, CancellationToken ct = default);
}
```

- [x] **Step 4: Integration test trước cho store** — `GeometryVersionStoreTests` (PostgisFixture,
  mở `NetworkNodeRepositoryTests` để copy cách dựng fixture/DbContext):

```csharp
// 1. GetNextVersion trên asset chưa có → 1; sau Append(v1) → 2.
// 2. Append v1 + v2 cùng asset → ListByAsset trả 2 bản, đúng GeoJson/ChangedBy/Reason, version 1..2.
// 3. Append trùng (asset, version) → ném ConflictException (unique constraint).
// 4. ListByAsset của asset khác → rỗng (cách ly theo asset).
```

- [x] **Step 5: Implement persistence + store + migration.**

`GeometryVersionPersistenceModel.cs`:

```csharp
using NetTopologySuite.Geometries;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class GeometryVersionPersistenceModel
{
    public string Id { get; set; } = default!;
    public string AssetId { get; set; } = default!;
    public string AssetKind { get; set; } = default!;
    public int Version { get; set; }
    public Geometry? Geometry { get; set; }        // generic geometry(Geometry,4326), nullable
    public string GeoJson { get; set; } = default!;
    public string? ChangedBy { get; set; }
    public string? Reason { get; set; }
    public DateTime ChangedAt { get; set; }
}
```

`GeometryVersionConfiguration.cs` — table `geometry_versions`; `HasMaxLength` cho id/asset_id (64)/
asset_kind (16); `Geometry` cột `geometry(Geometry,4326)` nullable; `GeoJson` cột `geojson` text;
unique `ux_geometry_versions_asset_version (asset_id, version)`; index btree
`ix_geometry_versions_asset (asset_id, version)` (desc tùy provider); **không** GiST; **không**
`HasQueryFilter` (append-only, không soft-delete).

`GisDbContext.cs` — thêm:

```csharp
public DbSet<GeometryVersionPersistenceModel> GeometryVersions => Set<GeometryVersionPersistenceModel>();
```

`GeometryVersionStore.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class GeometryVersionStore(GisDbContext dbContext) : IGeometryVersionStore
{
    public async Task<int> GetNextVersionAsync(string assetId, CancellationToken ct = default)
    {
        var max = await dbContext.GeometryVersions
            .Where(x => x.AssetId == assetId)
            .Select(x => (int?)x.Version)
            .MaxAsync(ct);
        return (max ?? 0) + 1;
    }

    // Stage only — do NOT SaveChanges; the aggregate repo's outbox transaction commits everything.
    public Task AppendAsync(GeometryVersion version, CancellationToken ct = default)
    {
        dbContext.GeometryVersions.Add(ToModel(version));
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<GeometryVersion>> ListByAssetAsync(string assetId, CancellationToken ct = default)
    {
        var rows = await dbContext.GeometryVersions.AsNoTracking()
            .Where(x => x.AssetId == assetId)
            .OrderByDescending(x => x.Version)
            .ToListAsync(ct);
        return rows.Select(ToDomain).ToList();
    }

    private static GeometryVersionPersistenceModel ToModel(GeometryVersion v) => new()
    {
        Id = v.Id, AssetId = v.AssetId, AssetKind = v.AssetKind.ToString(), Version = v.Version,
        Geometry = null, GeoJson = v.GeoJson, ChangedBy = v.ChangedBy, Reason = v.Reason, ChangedAt = v.ChangedAt
    };

    private static GeometryVersion ToDomain(GeometryVersionPersistenceModel m)
        => GeometryVersion.Reconstitute(m.Id, m.AssetId, AssetKind.Parse(m.AssetKind),
            m.Version, m.GeoJson, m.ChangedBy, m.Reason, m.ChangedAt);
}
```

> **Transaction note:** `AppendAsync` chỉ stage (`Add`), không `SaveChanges`. Vì handler relocate gọi
> `AppendAsync` rồi `repository.SaveAsync(node)` trên **cùng `GisDbContext`** (scoped), outbox
> transaction của `AggregateRepositoryBase.PersistWithOutboxAsync` sẽ commit cả node lẫn geometry
> version atomically. Xác minh bằng integration test relocate ở Task 3 (Step 4 case append-in-tx).
> Riêng `GeometryVersionStoreTests` (Task 1) tự gọi `dbContext.SaveChangesAsync` trong test để kiểm
> store độc lập — hoặc test qua một save aggregate giả; chọn cách khớp `NetworkNodeRepositoryTests`.

`migration M4`:

```bash
cd src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure
dotnet ef migrations add AddGeometryVersions
```

(Đối chiếu migration sinh ra: bảng `geometry_versions`, unique + btree index, **không** GiST.)

- [x] **Step 6: DI trong `Program.cs`:** `builder.Services.AddScoped<IGeometryVersionStore, GeometryVersionStore>();`

- [x] **Step 7: Chạy test PASS** (unit + integration). Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`
  rồi `dotnet test tests/WaterNetwork.Gis.IntegrationTests`.

- [x] **Step 8: Commit.** `feat(gis): add geometry version audit store (M4)`

### Task 2: `NetworkNode.Relocate` + `NodeRelocated` event (domain TDD)

**Files:** Modify `Domain/Aggregates/NetworkNode.cs`; Create `Domain/DomainEvents/NodeRelocated.cs`;
Test add vào `UnitTests/Domain/NetworkNodeTests.cs`.

- [x] **Step 1: Tests trước** (thêm vào `NetworkNodeTests`):

```csharp
[Fact]
public void Relocate_Changes_Location_And_Bumps_Version()
{
    var node = NetworkNode.Register("t1", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));
    node.ClearDomainEvents();
    var before = node.Version;

    node.Relocate(new GeoPoint(10.5, 106.5), changedBy: "user-1", reason: "survey fix");

    node.Location.Latitude.Should().Be(10.5);
    node.Location.Longitude.Should().Be(106.5);
    node.Version.Should().Be(before + 1);
}

[Fact]
public void Relocate_Raises_Exactly_One_NodeRelocated_With_Old_And_New()
{
    var node = NetworkNode.Register("t1", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));
    node.ClearDomainEvents();

    node.Relocate(new GeoPoint(10.5, 106.5), "user-1", "survey fix");

    var evt = node.GetDomainEvents().Single().Should().BeOfType<NodeRelocated>().Subject;
    evt.AggregateId.Should().Be(node.Id);
    evt.Data.OldLatitude.Should().Be(10.0);
    evt.Data.OldLongitude.Should().Be(106.0);
    evt.Data.NewLatitude.Should().Be(10.5);
    evt.Data.NewLongitude.Should().Be(106.5);
    evt.Data.Reason.Should().Be("survey fix");
}

[Fact]
public void Relocate_To_Same_Location_Throws_NoLocationChange()
{
    var node = NetworkNode.Register("t1", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));
    var act = () => node.Relocate(new GeoPoint(10.0, 106.0), null, null);
    act.Should().Throw<DomainException>().Which.Code.Should().Contain("NetworkNode.NoLocationChange");
}
```

(Dùng đúng tên member event thật: file dùng `GetDomainEvents()` — mirror `NetworkNodeTests` hiện có.)

- [x] **Step 2: FAIL.** Run unit tests.

- [x] **Step 3: Implement.**

`NodeRelocated.cs` (mirror `NodeRegistered`/`NodeDeleted`):

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record NodeRelocatedData(
    string TenantId, string AssetCode,
    double OldLatitude, double OldLongitude,
    double NewLatitude, double NewLongitude,
    string? Reason);

public sealed record NodeRelocated(string AggregateId, NodeRelocatedData Data)
    : DomainEventBase<NodeRelocatedData>(
        aggregateId: AggregateId, aggregateType: "NetworkNode",
        eventType: "NodeRelocated", data: Data);
```

`NetworkNode.cs` — thêm method (cạnh `SoftDelete`):

```csharp
public void Relocate(GeoPoint newLocation, string? changedBy, string? reason)
{
    if (newLocation.Equals(Location))
        throw new DomainException("NetworkNode.NoLocationChange",
            "New location is identical to the current location.");

    var old = Location;
    Location = newLocation;
    MarkAsModified();

    AddDomainEvent(new NodeRelocated(Id, new NodeRelocatedData(
        TenantId: TenantId, AssetCode: AssetCode.Value,
        OldLatitude: old.Latitude, OldLongitude: old.Longitude,
        NewLatitude: newLocation.Latitude, NewLongitude: newLocation.Longitude,
        Reason: reason)));
}
```

(`changedBy` không vào event payload — nó dùng cho GeometryVersion ở handler. Nếu cần audit trong
event, để dành. Bỏ tham số `changedBy` khỏi method nếu không dùng — giữ chữ ký gọn; ở đây giữ để
handler truyền nhất quán, hoặc bỏ và handler tự dùng. **Chốt: bỏ `changedBy` khỏi `Relocate`**, chỉ
giữ `reason`; handler đọc actor riêng cho version. Cập nhật test cho khớp.)

> Quyết định gọn: `Relocate(GeoPoint newLocation, string? reason)`. Sửa test Step 1 bỏ `changedBy`.

- [x] **Step 4: PASS.** Run unit tests.

- [x] **Step 5: Commit.** `feat(gis): add NetworkNode.Relocate with NodeRelocated event`

### Task 3: `RelocateNodeCommand` + handler + hook RegisterNode → GeometryVersion v1

**Files:** Create `Application/Commands/RelocateNodeCommand.cs`, `RelocateNodeCommandHandler.cs`,
`Application/Validators/RelocateNodeCommandValidator.cs`; modify `RegisterNodeCommandHandler.cs`
(append v1); Test `UnitTests/Application/RelocateNodeCommandHandlerTests.cs`,
`RelocateNodeCommandValidatorTests.cs`; integration `IntegrationTests/RelocateNodeFlowTests.cs`.

- [x] **Step 1: Tests trước.**

`RelocateNodeCommandValidatorTests`: lat/lng range (mirror register), `NodeId` NotEmpty.

`RelocateNodeCommandHandlerTests` (NSubstitute; mock `INetworkNodeRepository`, `IGeometryVersionStore`,
`IRequestContext`/actor accessor — mở `RegisterNodeCommandHandlerTests` để biết actor lấy từ đâu):

```csharp
// 1. Happy: node tồn tại → handler load, Relocate, GetNextVersion → n, AppendAsync(version=n, geoJson
//    chứa toạ độ mới), SaveAsync(node). Assert AppendAsync Received(1) với Version == n và GeoJson
//    chứa "10.5"/"106.5"; SaveAsync Received(1).
// 2. Node không tồn tại (GetById → null) → NotFoundException; AppendAsync/SaveAsync DidNotReceive.
// 3. Relocate cùng vị trí → DomainException NoLocationChange propagate; AppendAsync DidNotReceive.
// 4. GetNextVersion trả 2 (đã có v1) → AppendAsync version == 2.
```

- [x] **Step 2: FAIL.** Run unit tests.

- [x] **Step 3: Implement.**

`RelocateNodeCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RelocateNodeCommand(string NodeId, double Latitude, double Longitude, string? Reason)
    : ICommand;   // no return value (mirror void-command convention; if base needs ICommand<Unit>, match it)
```

(Nếu `ICommand` không có biến thể void trong building blocks, dùng `ICommand<string>` trả `NodeId`.
Mở một command hiện có để xác nhận; **mặc định trả `string` (NodeId)** cho an toàn.)

`RelocateNodeCommandValidator.cs` — mirror `InstallDeviceCommandValidator` (lat/lng range, NodeId NotEmpty).

`RelocateNodeCommandHandler.cs`:

```csharp
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RelocateNodeCommandHandler(
    INetworkNodeRepository nodeRepository,
    IGeometryVersionStore geometryVersionStore,
    IRequestContext requestContext)            // mirror actual actor accessor name
    : ICommandHandler<RelocateNodeCommand, string>
{
    public async Task<string> HandleAsync(RelocateNodeCommand command, CancellationToken ct)
    {
        var node = await nodeRepository.GetByIdAsync(command.NodeId, ct)
            ?? throw NotFoundException.For("NetworkNode", command.NodeId);

        node.Relocate(new GeoPoint(command.Latitude, command.Longitude), command.Reason);

        var version = await geometryVersionStore.GetNextVersionAsync(node.Id, ct);
        var geoJson = GeoJsonPoint(command.Longitude, command.Latitude);
        await geometryVersionStore.AppendAsync(
            GeometryVersion.Create(node.Id, AssetKind.Parse("Node"), version, geoJson,
                changedBy: requestContext.ActorId, reason: command.Reason), ct);

        await nodeRepository.SaveAsync(node, ct);   // outbox tx commits node + staged version atomically
        return node.Id;
    }

    // GeoJSON Point is [longitude, latitude] per RFC 7946.
    private static string GeoJsonPoint(double lng, double lat)
        => $"{{\"type\":\"Point\",\"coordinates\":[{lng.ToString(System.Globalization.CultureInfo.InvariantCulture)},{lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}]}}";
}
```

(`NotFoundException.For` / `IRequestContext.ActorId`: dùng đúng API thật — mở exceptions building block
+ một handler đọc actor. Nếu chưa có `NotFoundException`, dùng cái tương đương đang dùng cho GET 404,
hoặc `BusinessRuleException` → nhưng GET detail trả 404 nên ưu tiên `NotFoundException`.)

- [x] **Step 4: Hook RegisterNode → GeometryVersion v1.** Sửa `RegisterNodeCommandHandler`: sau khi
  tạo node và **trước** `SaveAsync`, append `GeometryVersion.Create(node.Id, Node, version:1, geoJson)`
  (GetNextVersion sẽ trả 1 cho asset mới — gọi cho nhất quán). Cập nhật `RegisterNodeCommandHandlerTests`:
  assert `AppendAsync` Received(1) với Version==1. Inject `IGeometryVersionStore` vào handler + DI.

> **Lưu ý regression:** việc thêm append vào RegisterNode là thay đổi flow đã test. Chạy lại toàn bộ
> `RegisterNodeCommandHandlerTests` + E2E register node để chắc không vỡ. Nếu muốn giảm rủi ro, có thể
> tách bước này thành commit riêng.

- [x] **Step 5: Integration test `RelocateNodeFlowTests`** (PostgisFixture, real DbContext + store +
  node repo, outbox): register node (qua repo/command) → relocate → assert:
  (a) node.Location đổi trong DB; (b) `geometry_versions` có **2 bản** (v1 register, v2 relocate);
  (c) cùng transaction: nếu SaveAsync ném (giả lập version mismatch) thì version v2 **không** tồn tại
  (atomicity) — case này optional nếu khó dựng.

- [x] **Step 6: DI** trong `Program.cs` (handler tự đăng ký qua assembly scan nếu có; nếu không, thêm).

- [x] **Step 7: PASS** unit + integration.

- [x] **Step 8: Commit.** `feat(gis): add RelocateNode command with geometry versioning`

### Task 4: `SoftDelete()` + `PipeDeleted`/`DeviceDeleted` cho pipe/device (domain TDD)

**Files:** Modify `Domain/Aggregates/NetworkPipe.cs`, `NetworkDevice.cs`; Create
`Domain/DomainEvents/PipeDeleted.cs`, `DeviceDeleted.cs`; Test add vào `NetworkPipeTests`, `NetworkDeviceTests`.

- [x] **Step 1: Tests** (mirror `NetworkNodeTests` SoftDelete case):

```csharp
// NetworkPipeTests:
[Fact]
public void SoftDelete_Stamps_DeletedAt_And_Raises_PipeDeleted()
{
    var pipe = MakePipe();           // helper hiện có
    pipe.ClearDomainEvents();
    pipe.SoftDelete();
    pipe.DeletedAt.Should().NotBeNull();
    var evt = pipe.GetDomainEvents().Single().Should().BeOfType<PipeDeleted>().Subject;
    evt.AggregateId.Should().Be(pipe.Id);
    evt.Data.AssetCode.Should().Be(pipe.AssetCode.Value);
}
// NetworkDeviceTests: tương tự với DeviceDeleted (data kèm DeviceType).
```

- [x] **Step 2: FAIL.**

- [x] **Step 3: Implement** `PipeDeleted`/`DeviceDeleted` (mirror `NodeDeleted` — data tối thiểu:
  Pipe `{TenantId, AssetCode}`; Device `{TenantId, AssetCode, DeviceType}`), và `SoftDelete()` trên
  hai aggregate (mirror `NetworkNode.SoftDelete` từng dòng).

- [x] **Step 4: PASS.**

- [x] **Step 5: Commit.** `feat(gis): add soft-delete to pipe and device aggregates`

### Task 5: Remove commands + handlers + rule chặn + repo DeleteAsync/Exists*

**Files:** Create `Application/Commands/RemoveNodeCommand(+Handler)`, `RemovePipeCommand(+Handler)`,
`RemoveDeviceCommand(+Handler)`; modify pipe/device repo (+ interfaces); Test handler unit +
integration repo.

- [x] **Step 1: Repo interface + impl — query methods.**

`INetworkPipeRepository`: thêm

```csharp
Task DeleteAsync(string id, CancellationToken ct = default);
Task<bool> ExistsByEndpointNodeAsync(string nodeId, CancellationToken ct = default);
```

`INetworkDeviceRepository`: thêm

```csharp
Task DeleteAsync(string id, CancellationToken ct = default);
Task<bool> ExistsByHostPipeAsync(string pipeId, CancellationToken ct = default);
Task<bool> ExistsByHostNodeAsync(string nodeId, CancellationToken ct = default);
```

Impl (mirror `NetworkNodeRepository.DeleteAsync` đã soft-delete):

```csharp
// NetworkPipeRepository
public override async Task DeleteAsync(string id, CancellationToken ct = default)
{
    var pipe = await GetByIdAsync(id, ct);
    if (pipe is null) return;          // already gone / soft-deleted (query filter) — no-op
    pipe.SoftDelete();
    await SaveAsync(pipe, ct);
}

public async Task<bool> ExistsByEndpointNodeAsync(string nodeId, CancellationToken ct = default)
    => await dbContext.NetworkPipes
        .AnyAsync(x => x.FromNodeId == nodeId || x.ToNodeId == nodeId, ct);
    // query filter DeletedAt==null đã loại pipe đã xóa.

// NetworkDeviceRepository
public override async Task DeleteAsync(string id, CancellationToken ct = default) { /* mirror */ }
public async Task<bool> ExistsByHostPipeAsync(string pipeId, CancellationToken ct = default)
    => await dbContext.NetworkDevices.AnyAsync(x => x.HostPipeId == pipeId, ct);
public async Task<bool> ExistsByHostNodeAsync(string nodeId, CancellationToken ct = default)
    => await dbContext.NetworkDevices.AnyAsync(x => x.HostNodeId == nodeId, ct);
```

(Xóa `throw new NotSupportedException(...)` cũ.)

- [x] **Step 2: Handler unit tests** (NSubstitute):

```csharp
// RemoveNodeCommandHandlerTests:
// - node tồn tại, không pipe/không device → node.SoftDelete via repo.DeleteAsync Received(1).
//   (Cách tổ chức: handler gọi pipeRepo.ExistsByEndpointNode + deviceRepo.ExistsByHostNode, nếu sạch
//    gọi nodeRepo.DeleteAsync(id). Hoặc load node + SoftDelete + SaveAsync — chọn 1, nhất quán. Plan
//    chốt: handler kiểm rule rồi gọi nodeRepo.DeleteAsync(id).)
// - ExistsByEndpointNode → true → BusinessRuleException "NetworkNode.HasConnectedPipes"; DeleteAsync DidNotReceive.
// - ExistsByHostNode → true → "NetworkNode.HasAttachedDevices"; DeleteAsync DidNotReceive.
// - node không tồn tại (GetById → null) → NotFoundException.
//
// RemovePipeCommandHandlerTests:
// - ExistsByHostPipe true → "NetworkPipe.HasAttachedDevices" (422).
// - sạch → pipeRepo.DeleteAsync Received(1).
// - pipe không tồn tại → NotFoundException.
//
// RemoveDeviceCommandHandlerTests:
// - device tồn tại → deviceRepo.DeleteAsync Received(1).
// - device không tồn tại → NotFoundException.
```

- [x] **Step 3: Implement commands + handlers.** Ví dụ `RemoveNodeCommandHandler`:

```csharp
public sealed class RemoveNodeCommandHandler(
    INetworkNodeRepository nodeRepository,
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository) : ICommandHandler<RemoveNodeCommand>
{
    public async Task HandleAsync(RemoveNodeCommand command, CancellationToken ct)
    {
        var node = await nodeRepository.GetByIdAsync(command.NodeId, ct)
            ?? throw NotFoundException.For("NetworkNode", command.NodeId);

        if (await pipeRepository.ExistsByEndpointNodeAsync(node.Id, ct))
            throw new BusinessRuleException("NetworkNode.HasConnectedPipes",
                $"Node '{node.Id}' is an endpoint of one or more pipes and cannot be removed.");
        if (await deviceRepository.ExistsByHostNodeAsync(node.Id, ct))
            throw new BusinessRuleException("NetworkNode.HasAttachedDevices",
                $"Node '{node.Id}' hosts one or more devices and cannot be removed.");

        await nodeRepository.DeleteAsync(node.Id, ct);
    }
}
```

(`ICommand`/`ICommandHandler` void: dùng đúng biến thể building blocks. Nếu chỉ có `ICommand<T>`, trả
`string` NodeId. RemovePipe/RemoveDevice tương tự — pipe check device, device không check.)

- [x] **Step 4: Integration repo tests** (`NetworkPipeRepositoryTests`/`NetworkDeviceRepositoryTests` mở rộng):
  soft-delete round-trip (Delete → GetById null do filter); `ExistsByEndpointNode` true khi có pipe nối,
  false sau khi pipe bị xóa; `ExistsByHostPipe/Node` đúng.

- [x] **Step 5: DI** handlers (assembly scan hoặc thêm tay).

- [x] **Step 6: PASS** unit + integration.

- [x] **Step 7: Commit.** `feat(gis): add remove commands with reference-guard rules`

### Task 6: Contracts + mapper registry (4 event) + contract tests

**Files:** Create `Contracts/Events/NetworkNodeDeletedV1.cs`, `NetworkPipeDeletedV1.cs`,
`NetworkDeviceDeletedV1.cs`, `NetworkNodeRelocatedV1.cs`; modify `Contracts/Events/GisEventTypes.cs`,
`Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs`; Test
`ContractTests/NetworkNodeDeletedContractTests.cs` (+ pipe/device/relocated, hoặc gộp 1 file).

- [x] **Step 1: Contract tests trước** (mirror `NetworkPipeRegisteredContractTests`): mỗi event mới —
  map domain event → integration event đúng `EventType` const, `EventVersion=1`, `SourceAggregateId/Type`,
  và Data field khớp. Regression: 3 event cũ vẫn map. Event lạ (`CanMap("nope")==false`, `Map(spoof)==null`).

- [x] **Step 2: FAIL.**

- [x] **Step 3: Implement contracts** (naming `Network{Aggregate}{Action}V1`):

```csharp
public sealed record NetworkNodeDeletedV1(string NodeId, string TenantId, string AssetCode, string NodeType);
public sealed record NetworkPipeDeletedV1(string PipeId, string TenantId, string AssetCode);
public sealed record NetworkDeviceDeletedV1(string DeviceId, string TenantId, string AssetCode, string DeviceType);
public sealed record NetworkNodeRelocatedV1(
    string NodeId, string TenantId, string AssetCode,
    double OldLatitude, double OldLongitude, double NewLatitude, double NewLongitude, string? Reason);
```

`GisEventTypes` — thêm:

```csharp
public const string NodeDeleted   = "network.node.deleted";
public const string PipeDeleted   = "network.pipe.deleted";
public const string DeviceDeleted = "network.device.deleted";
public const string NodeRelocated = "network.node.relocated";
```

`GisIntegrationEventMapper` — thêm 4 integration event record (mirror các record đầu file) + 4 registry
entry + 4 helper `Map*` (mirror `MapNodeRegistered`):

```csharp
["NodeDeleted"]   = e => e is NodeDeleted   x ? MapNodeDeleted(x)   : null,
["PipeDeleted"]   = e => e is PipeDeleted   x ? MapPipeDeleted(x)   : null,
["DeviceDeleted"] = e => e is DeviceDeleted x ? MapDeviceDeleted(x) : null,
["NodeRelocated"] = e => e is NodeRelocated x ? MapNodeRelocated(x) : null,
```

- [x] **Step 4: PASS** contract tests.

- [x] **Step 5: Commit.** `feat(gis): map delete and relocate integration events`

### Task 7: API endpoints + read query + E2E

**Files:** modify `NodesEndpointModule` (DELETE, PATCH, geometry-history), `PipesEndpointModule` (DELETE),
`DevicesEndpointModule` (DELETE); Create `Contracts/Requests/RelocateNodeRequest.cs`,
`Api/Validators/RelocateNodeRequestValidator.cs`, `Application/Ports/IGeometryVersionReadDao.cs`,
`Application/Dtos/GeometryVersionDto.cs`, `Application/Queries/GetNodeGeometryHistoryQuery(+Handler).cs`,
`Infrastructure/Repositories/GeometryVersionReadDao.cs`; modify `Program.cs` (DI); Test
`IntegrationTests/RemoveAndRelocateApiTests.cs`.

- [x] **Step 1: Read side** — `GetNodeGeometryHistoryQuery(NodeId) : IQuery<IReadOnlyList<GeometryVersionDto>>`
  + handler qua `IGeometryVersionReadDao` (Dapper, mirror `DeviceReadDao`): `select id, version, geojson,
  changed_by, reason, changed_at from geometry_versions where asset_id=@id order by version desc`.
  `GeometryVersionDto {Version, GeoJson, ChangedBy, Reason, ChangedAt}`.

- [x] **Step 2: Endpoints** (mirror pattern hiện có — `MapGroup`, `RequirePermission`, `WithValidation`):

```csharp
// NodesEndpointModule (thêm vào group "/api/network/nodes"):
group.MapDelete("/{id}", async Task<Results<NoContent, NotFound, ...>> (
        string id, ICommandBus commandBus, CancellationToken ct) =>
    {
        await commandBus.ExecuteAsync(new RemoveNodeCommand(id), ct);   // 422/404 do middleware map
        return TypedResults.NoContent();
    })
    .RequirePermission("network-gis:write");

group.MapPatch("/{id}/location", async (string id, RelocateNodeRequest req, ICommandBus commandBus, CancellationToken ct) =>
    {
        await commandBus.ExecuteAsync(new RelocateNodeCommand(id, req.Latitude, req.Longitude, req.Reason), ct);
        return Results.NoContent();
    })
    .WithValidation<RelocateNodeRequest>()
    .RequirePermission("network-gis:write");

group.MapGet("/{id}/geometry-history", async (string id, IQueryBus queryBus, CancellationToken ct) =>
        TypedResults.Ok(await queryBus.ExecuteAsync(new GetNodeGeometryHistoryQuery(id), ct)))
    .RequirePermission("network-gis:read");

// PipesEndpointModule + DevicesEndpointModule: MapDelete("/{id}", ... RemovePipeCommand/RemoveDeviceCommand) → 204.
```

`RelocateNodeRequest {double Latitude, double Longitude, string? Reason}` + validator (lat/lng range);
đăng ký validator API-assembly (template-mapping §7.4).

- [x] **Step 3: DI** read dao + query handler trong `Program.cs`.

- [x] **Step 4: E2E `RemoveAndRelocateApiTests`** (`GisApiFactory`):

```text
// Seed qua API: node A, node B, pipe P(A,B), device D host trên node A.
// 1. DELETE /nodes/{A} → 422 NetworkNode.HasConnectedPipes (P còn sống).
// 2. DELETE /devices/{D} → 204; outbox có network.device.deleted.
// 3. DELETE /nodes/{A} → vẫn 422 (pipe P còn). DELETE /pipes/{P} →
//    nếu device khác host trên P thì 422; ở đây P không host device → 204.
// 4. Sau khi P xóa: DELETE /nodes/{A} → 204 (sạch pipe; device D đã xóa). outbox network.node.deleted.
// 5. PATCH /nodes/{B}/location {lat:10.5,lng:106.5} → 204; outbox network.node.relocated;
//    GET /nodes/{B}/geometry-history → 2 bản (v1 register, v2 relocate), v2 toạ độ mới, desc.
// 6. PATCH relocate lat=99 → 400 (validation).
// 7. DELETE /nodes/{nonexistent} → 404.
```

- [x] **Step 5: PASS** integration/E2E.

- [x] **Step 6: Commit.** `feat(gis): expose remove, relocate and geometry-history endpoints`

### Task 8: Đóng follow-up backlog (pipe backstop + update-path test)

**Files:** modify `Infrastructure/Repositories/NetworkPipeRepository.cs` (hoặc handler);
Test `IntegrationTests/NetworkPipeRepositoryTests.cs`, `NetworkDeviceRepositoryTests.cs`.

- [x] **Step 1: Pipe unique-violation backstop.** Mở `NetworkNodeRepository`/`NetworkDeviceRepository`
  xem cách bắt `DbUpdateException`/Postgres 23505 → `ConflictException` (helper `FindPostgresException`).
  Áp **đúng pattern đó** vào `NetworkPipeRepository.PersistAsync` insert path. Integration test:
  save 2 pipe cùng `(tenant, asset_code)` đua nhau → lần 2 `ConflictException` (mirror device test).

- [x] **Step 2: Update-path round-trip test** (đóng follow-up #5): cho device + pipe, test nhánh `else`
  của `PersistAsync`: save (v0) → reload/Reconstitute → mutate (relocate node đã cover node; với pipe/
  device dùng SoftDelete làm mutation) → save lần 2 → assert version tăng + `DeletedAt` set + field giữ.
  (Phần lớn đã chạm qua Task 5 soft-delete integration test — bổ sung assert version round-trip nếu thiếu.)

- [x] **Step 3: PASS.**

- [x] **Step 4: Commit.** `test(gis): pipe unique-violation backstop and repo update-path coverage`

### Task 9: Docs + decision + backlog + final verification

- [x] **Step 1: Decision record** (nếu chốt "deleted" khác roadmap "removed"):
  `docs/decisions/00xx-gis-remove-event-naming.md` — ghi lý do giữ `network.*.deleted`.

- [x] **Step 2: `template-mapping.md` §7** — thêm 2 pattern: (a) soft-delete (rule tham chiếu ở handler,
  `SoftDelete()` ở aggregate, repo `DeleteAsync` = load+SoftDelete+Save); (b) GeometryVersion
  append-in-transaction (store stage-only, aggregate repo outbox tx commit chung).

- [x] **Step 3: `docs/stories/backlog.md`** — đóng follow-up "RegisterPipe thiếu backstop" + "Update-path
  test"; cập nhật dòng Phase 1: "GIS-1, GIS-2, GIS-3 done". Cập nhật roadmap §3.3/§4.4 nếu cần (event
  naming, M4 đã dùng cho geometry_versions).

- [x] **Step 4: Final verification:**
  - `dotnet test` **từng** test project (UnitTests, IntegrationTests, ContractTests) — tất cả xanh.
  - `dotnet build WaterNetwork.Gis.slnx` — 0 warning (TreatWarningsAsErrors).
  - `docker compose config --quiet` (nếu đụng compose) parse OK.
  - Rà các E2E quan trọng: remove rule 422, relocate + history 2 bản, outbox 4 event mới.
  - **Verification subagent** (high-stakes): spawn 1 subagent rà toàn bộ diff để bắt: rule chặn dùng
    đúng repo (không đọc DB chéo), GeometryVersion atomic với save, mapper không vỡ regression 3 event cũ,
    không hard-delete đâu đó, query filter `DeletedAt==null` không vô tình ẩn geometry_versions.

- [x] **Step 5: Commit cuối + (tùy) `superpowers:finishing-a-development-branch`.**

---

## Definition of Done (DoD — kế thừa roadmap §17)

1. Domain rule đúng layer; relocate/soft-delete/geometry-version có unit test (no-op, append-only, raise event).
2. Command/query có validator; API có E2E (422 rule, 404, 400 validation, relocate+history).
3. Migration M4 committed; 4 event mới qua outbox; contract test cho mỗi event + regression 3 event cũ.
4. Tenant + correlation xuyên suốt (không thêm bề mặt mới cần test cách ly tenant ngoài cái có sẵn).
5. `dotnet test` từng project xanh, 0 warning; compose parse; `template-mapping.md` + backlog cập nhật.

## Rủi ro riêng slice này

- **Atomicity GeometryVersion ↔ aggregate save**: store stage-only + outbox tx của repo phải dùng
  **cùng `GisDbContext` scoped**. Nếu DI tạo 2 DbContext khác nhau cho store và repo → version commit
  ngoài transaction node. Verify bằng integration test atomic (Task 3 Step 5) + DI dùng `AddScoped`.
- **Regression RegisterNode** (thêm append v1): chạy lại full register tests/E2E (Task 3 Step 4 note).
- **`MaxAsync` trên cột int khi rỗng**: dùng `(int?)x.Version` rồi `?? 0` (đã xử lý trong store).
- **Query filter ẩn pipe đã xóa khỏi `ExistsByEndpointNode`**: đúng ý đồ (chỉ chặn bởi pipe **sống**),
  nhưng phải có test khẳng định pipe đã xóa → `Exists==false`.
