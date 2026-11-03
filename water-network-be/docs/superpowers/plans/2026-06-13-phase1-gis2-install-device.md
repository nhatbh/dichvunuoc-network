# Phase 1 — GIS-2 InstallDevice (US-P1-03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slice end-to-end `InstallDevice` trên `water-network-gis-be`: command → aggregate `NetworkDevice` (host rules theo deviceType) → persistence PostGIS (Point 4326, migration M3) → domain event `DeviceInstalled` → outbox → integration event `network.device.installed` v1 → endpoint `POST /api/network/devices` + `GET /api/network/devices/{id}` → 3 tầng test xanh. Kèm: refactor `GisIntegrationEventMapper` sang registry, decision record 0009 chốt route prefix.

**Architecture:** Mirror slice GIS-1 RegisterPipe — mọi file mới đặt cạnh file pipe tương ứng, cùng namespace. Bất biến host-shape nằm trong VO `DeviceHost` (DomainException → 400); host-tồn-tại nằm trong handler qua repository (BusinessRuleException → 422). KHÔNG sửa hành vi node/pipe trừ mapper refactor (Task 5).

**Tech Stack:** .NET 10, EF Core + NetTopologySuite (write), Dapper (read), PostGIS, FluentValidation, xUnit + FluentAssertions + NSubstitute, Testcontainers (PostgisFixture).

**Spec:** `docs/superpowers/specs/2026-06-13-gis2-install-device-design.md`

---

## Quy ước & quyết định chốt cho slice này

- Thư mục gốc service: `src/services/water-network-gis-be/` (gọi tắt **GIS**); mọi đường dẫn tương đối tính từ đó trừ khi ghi rõ repo root.
- **Route**: `/api/network/devices` — chốt bằng decision record 0009 (Task 7): service không tự version route, `/v1/` là việc của YARP gateway (US-X).
- **Id format**: `device-{Guid.CreateVersion7():N}` (mirror `pipe-`).
- **Host matrix (strict — host thừa bị reject, không silently ignore):**

  | DeviceType | hostPipeId | hostNodeId | Sai → DomainException |
  |---|---|---|---|
  | Valve, FlowMeter | bắt buộc | cấm | `DeviceHost.HostRequired` / `DeviceHost.HostNotAllowed` |
  | Pump, Hydrant | cấm | bắt buộc | `DeviceHost.HostRequired` / `DeviceHost.HostNotAllowed` |
  | PressureSensor | đúng một trong hai | | thiếu cả hai → `HostRequired`; cả hai → `DeviceHost.AmbiguousHost` |

- **Tenant check trên host refs**: KHÔNG làm ở slice này — mirror GIS-1 (pipe handler cũng không check tenant của endpoint nodes). Ghi follow-up chung vào backlog (Task 7).
- **Detail DTO/request dùng `Latitude`/`Longitude` flat** (mirror `RegisterNodeRequest`), không nested object.
- `dotnet test` phải chạy **từng test project** (SDK 10.0.107 silently chạy 0 test với `.slnx`); build `WaterNetwork.Gis.slnx` để check 0 warning (TreatWarningsAsErrors).
- Commit conventional sau mỗi task, kết thúc bằng `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Bản đồ file mới / sửa

```text
src/services/water-network-gis-be/
├── src/
│   ├── WaterNetwork.Gis.Domain/
│   │   ├── ValueObjects/DeviceType.cs                  (Task 1)
│   │   ├── ValueObjects/DeviceHost.cs                  (Task 1)
│   │   ├── Aggregates/NetworkDevice.cs                 (Task 2)
│   │   ├── DomainEvents/DeviceInstalled.cs             (Task 2)
│   │   └── Repositories/INetworkDeviceRepository.cs    (Task 2)
│   ├── WaterNetwork.Gis.Application/
│   │   ├── Commands/InstallDeviceCommand.cs            (Task 3)
│   │   ├── Commands/InstallDeviceCommandHandler.cs     (Task 3)
│   │   ├── Validators/InstallDeviceCommandValidator.cs (Task 3)
│   │   ├── Ports/IDeviceReadDao.cs                     (Task 6)
│   │   ├── Dtos/DeviceDetailDto.cs                     (Task 6)
│   │   └── Queries/GetDeviceDetailQuery(+Handler).cs   (Task 6)
│   ├── WaterNetwork.Gis.Contracts/
│   │   ├── Events/NetworkDeviceInstalledV1.cs          (Task 5)
│   │   ├── Events/GisEventTypes.cs                     (Task 5 — thêm const)
│   │   └── Requests/InstallDeviceRequest.cs            (Task 6)
│   ├── WaterNetwork.Gis.Infrastructure/
│   │   ├── Persistence/NetworkDevicePersistenceModel.cs               (Task 4)
│   │   ├── Persistence/Configurations/NetworkDeviceConfiguration.cs   (Task 4)
│   │   ├── Persistence/GisDbContext.cs                                (Task 4 — thêm DbSet)
│   │   ├── Persistence/Migrations/…_AddNetworkDevices.cs              (Task 4 — M3)
│   │   ├── Repositories/NetworkDeviceRepository.cs                    (Task 4)
│   │   ├── Repositories/DeviceReadDao.cs                              (Task 6)
│   │   └── IntegrationEvents/GisIntegrationEventMapper.cs             (Task 5 — REFACTOR registry)
│   └── WaterNetwork.Gis.Api/
│       ├── Endpoints/DevicesEndpointModule.cs          (Task 6)
│       ├── Validators/InstallDeviceRequestValidator.cs (Task 6)
│       └── Program.cs                                  (Task 4 + 6 — DI)
└── tests/
    ├── WaterNetwork.Gis.UnitTests/
    │   ├── Domain/DeviceTypeTests.cs, DeviceHostTests.cs, NetworkDeviceTests.cs
    │   └── Application/InstallDeviceCommandHandlerTests.cs, InstallDeviceCommandValidatorTests.cs
    ├── WaterNetwork.Gis.IntegrationTests/
    │   ├── NetworkDeviceRepositoryTests.cs
    │   └── InstallDeviceApiTests.cs
    └── WaterNetwork.Gis.ContractTests/
        └── NetworkDeviceInstalledContractTests.cs
```

---

### Task 1: Value objects `DeviceType`, `DeviceHost` (TDD)

**Files:**
- Create: `src/WaterNetwork.Gis.Domain/ValueObjects/DeviceType.cs`
- Create: `src/WaterNetwork.Gis.Domain/ValueObjects/DeviceHost.cs`
- Test: `tests/WaterNetwork.Gis.UnitTests/Domain/DeviceTypeTests.cs`, `DeviceHostTests.cs`

- [x] **Step 1: Viết unit tests trước.**

`DeviceTypeTests` — mirror `PipeMaterialTests`:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class DeviceTypeTests
{
    [Theory]
    [InlineData("Valve", "Valve")]
    [InlineData("valve", "Valve")]
    [InlineData("FLOWMETER", "FlowMeter")]
    [InlineData("pressuresensor", "PressureSensor")]
    [InlineData("Pump", "Pump")]
    [InlineData("hydrant", "Hydrant")]
    public void Parse_Recognises_Catalog_CaseInsensitive(string input, string canonical)
        => DeviceType.Parse(input).ToString().Should().Be(canonical);

    [Theory]
    [InlineData("Sensor")]
    [InlineData("")]
    [InlineData("   ")]
    public void Parse_Unknown_Value_Throws(string input)
    {
        var act = () => DeviceType.Parse(input);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceType.Invalid");
    }

    [Fact]
    public void Equality_Is_By_Canonical_Value()
        => DeviceType.Parse("valve").Should().Be(DeviceType.Parse("VALVE"));
}
```

`DeviceHostTests` — matrix 5 type × {host đúng, thiếu, thừa}:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class DeviceHostTests
{
    private static DeviceType T(string name) => DeviceType.Parse(name);

    // ---- Pipe-hosted: Valve, FlowMeter ----
    [Theory]
    [InlineData("Valve")]
    [InlineData("FlowMeter")]
    public void PipeHosted_WithPipeOnly_Succeeds(string type)
    {
        var host = DeviceHost.For(T(type), "pipe-1", null);
        host.HostPipeId.Should().Be("pipe-1");
        host.HostNodeId.Should().BeNull();
    }

    [Theory]
    [InlineData("Valve")]
    [InlineData("FlowMeter")]
    public void PipeHosted_MissingPipe_Throws_HostRequired(string type)
    {
        var act = () => DeviceHost.For(T(type), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceHost.HostRequired");
    }

    [Theory]
    [InlineData("Valve", "pipe-1", "node-1")]   // node thừa kèm pipe hợp lệ
    [InlineData("Valve", null, "node-1")]        // chỉ gửi node
    [InlineData("FlowMeter", "pipe-1", "node-1")]
    public void PipeHosted_WithNode_Throws_HostNotAllowed(string type, string? pipeId, string? nodeId)
    {
        var act = () => DeviceHost.For(T(type), pipeId, nodeId);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceHost.HostNotAllowed");
    }

    // ---- Node-hosted: Pump, Hydrant ----
    [Theory]
    [InlineData("Pump")]
    [InlineData("Hydrant")]
    public void NodeHosted_WithNodeOnly_Succeeds(string type)
    {
        var host = DeviceHost.For(T(type), null, "node-1");
        host.HostNodeId.Should().Be("node-1");
        host.HostPipeId.Should().BeNull();
    }

    [Theory]
    [InlineData("Pump")]
    [InlineData("Hydrant")]
    public void NodeHosted_MissingNode_Throws_HostRequired(string type)
    {
        var act = () => DeviceHost.For(T(type), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceHost.HostRequired");
    }

    [Theory]
    [InlineData("Pump", "pipe-1", "node-1")]
    [InlineData("Hydrant", "pipe-1", null)]
    public void NodeHosted_WithPipe_Throws_HostNotAllowed(string type, string? pipeId, string? nodeId)
    {
        var act = () => DeviceHost.For(T(type), pipeId, nodeId);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceHost.HostNotAllowed");
    }

    // ---- Either-hosted: PressureSensor (XOR) ----
    [Fact]
    public void PressureSensor_WithPipeOnly_Succeeds()
        => DeviceHost.For(T("PressureSensor"), "pipe-1", null).HostPipeId.Should().Be("pipe-1");

    [Fact]
    public void PressureSensor_WithNodeOnly_Succeeds()
        => DeviceHost.For(T("PressureSensor"), null, "node-1").HostNodeId.Should().Be("node-1");

    [Fact]
    public void PressureSensor_WithBoth_Throws_AmbiguousHost()
    {
        var act = () => DeviceHost.For(T("PressureSensor"), "pipe-1", "node-1");
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceHost.AmbiguousHost");
    }

    [Fact]
    public void PressureSensor_WithNeither_Throws_HostRequired()
    {
        var act = () => DeviceHost.For(T("PressureSensor"), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceHost.HostRequired");
    }

    // ---- Normalization & equality ----
    [Fact]
    public void Whitespace_Host_Is_Treated_As_Null()
    {
        var act = () => DeviceHost.For(T("Valve"), "   ", null);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("DeviceHost.HostRequired");
    }

    [Fact]
    public void Host_Ids_Are_Trimmed()
        => DeviceHost.For(T("Valve"), "  pipe-1  ", null).HostPipeId.Should().Be("pipe-1");

    [Fact]
    public void Equality_Is_By_Both_Refs()
        => DeviceHost.For(T("Valve"), "pipe-1", null)
            .Should().Be(DeviceHost.For(T("FlowMeter"), "pipe-1", null));
}
```

- [x] **Step 2: Chạy test xác nhận FAIL** (compile error vì VO chưa tồn tại):

Run: `dotnet test tests/WaterNetwork.Gis.UnitTests` (từ thư mục GIS)
Expected: build FAIL — `DeviceType`/`DeviceHost` not found.

- [x] **Step 3: Implement 2 VO.**

`DeviceType.cs` — mirror `PipeMaterial` từng dòng:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed class DeviceType : ValueObject
{
    private static readonly IReadOnlyDictionary<string, string> Catalog =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "Valve",          "Valve"          },
            { "FlowMeter",      "FlowMeter"      },
            { "PressureSensor", "PressureSensor" },
            { "Pump",           "Pump"           },
            { "Hydrant",        "Hydrant"        },
        };

    private readonly string _canonical;

    private DeviceType(string canonical)
    {
        _canonical = canonical;
    }

    public static DeviceType Parse(string value)
    {
        if (Catalog.TryGetValue(value?.Trim() ?? string.Empty, out var canonical))
            return new DeviceType(canonical);

        throw new DomainException("DeviceType.Invalid",
            $"'{value}' is not a recognised device type. Valid values: {string.Join(", ", Catalog.Values.Distinct())}.");
    }

    public override string ToString() => _canonical;

    protected override IEnumerable<object?> GetEqualityComponents() => new object?[] { _canonical };
}
```

`DeviceHost.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

/// <summary>
/// Host attachment of a device, validated against the per-type host matrix:
/// Valve/FlowMeter → hostPipeId only; Pump/Hydrant → hostNodeId only;
/// PressureSensor → exactly one of the two. Extra host refs are rejected,
/// never silently ignored.
/// </summary>
public sealed class DeviceHost : ValueObject
{
    public string? HostPipeId { get; }
    public string? HostNodeId { get; }

    private DeviceHost(string? hostPipeId, string? hostNodeId)
    {
        HostPipeId = hostPipeId;
        HostNodeId = hostNodeId;
    }

    public static DeviceHost For(DeviceType deviceType, string? hostPipeId, string? hostNodeId)
    {
        var pipeId = Normalize(hostPipeId);
        var nodeId = Normalize(hostNodeId);

        return deviceType.ToString() switch
        {
            "Valve" or "FlowMeter" => PipeHosted(deviceType, pipeId, nodeId),
            "Pump" or "Hydrant"    => NodeHosted(deviceType, pipeId, nodeId),
            "PressureSensor"       => EitherHosted(deviceType, pipeId, nodeId),
            // Unreachable: DeviceType.Parse only yields the 5 canonical values above.
            _ => throw new DomainException("DeviceType.Invalid",
                $"'{deviceType}' has no host rule defined.")
        };
    }

    private static string? Normalize(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static DeviceHost PipeHosted(DeviceType type, string? pipeId, string? nodeId)
    {
        if (nodeId is not null)
            throw new DomainException("DeviceHost.HostNotAllowed",
                $"A {type} attaches to a pipe only; hostNodeId must not be provided.");
        if (pipeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostPipeId.");
        return new DeviceHost(pipeId, null);
    }

    private static DeviceHost NodeHosted(DeviceType type, string? pipeId, string? nodeId)
    {
        if (pipeId is not null)
            throw new DomainException("DeviceHost.HostNotAllowed",
                $"A {type} attaches to a node only; hostPipeId must not be provided.");
        if (nodeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostNodeId.");
        return new DeviceHost(null, nodeId);
    }

    private static DeviceHost EitherHosted(DeviceType type, string? pipeId, string? nodeId)
    {
        if (pipeId is not null && nodeId is not null)
            throw new DomainException("DeviceHost.AmbiguousHost",
                $"A {type} must reference exactly one of hostPipeId or hostNodeId, not both.");
        if (pipeId is null && nodeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostPipeId or hostNodeId.");
        return new DeviceHost(pipeId, nodeId);
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return HostPipeId;
        yield return HostNodeId;
    }
}
```

- [x] **Step 4: Chạy test xác nhận PASS.**

Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`
Expected: PASS toàn bộ, 0 warning.

- [x] **Step 5: Commit.**

```bash
git add src/services/water-network-gis-be
git commit -m "feat(gis): add device type and host value objects

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: Aggregate `NetworkDevice` + domain event `DeviceInstalled` (TDD)

**Files:**
- Create: `src/WaterNetwork.Gis.Domain/Aggregates/NetworkDevice.cs`
- Create: `src/WaterNetwork.Gis.Domain/DomainEvents/DeviceInstalled.cs`
- Create: `src/WaterNetwork.Gis.Domain/Repositories/INetworkDeviceRepository.cs`
- Test: `tests/WaterNetwork.Gis.UnitTests/Domain/NetworkDeviceTests.cs`

- [x] **Step 1: Tests trước.**

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class NetworkDeviceTests
{
    private static NetworkDevice InstallValve() => NetworkDevice.Install(
        tenantId: "tenant-001",
        assetCode: new AssetCode("DV-001"),
        deviceType: DeviceType.Parse("Valve"),
        host: DeviceHost.For(DeviceType.Parse("Valve"), "pipe-1", null),
        location: new GeoPoint(10.762622, 106.660172));

    [Fact]
    public void Install_Assigns_DevicePrefixed_Id()
        => InstallValve().Id.Should().StartWith("device-");

    [Fact]
    public void Install_Raises_Exactly_One_DeviceInstalled_Event()
    {
        var device = InstallValve();

        device.DomainEvents.Should().ContainSingle();
        var evt = device.DomainEvents.Single().Should().BeOfType<DeviceInstalled>().Subject;
        evt.AggregateId.Should().Be(device.Id);
        evt.Data.TenantId.Should().Be("tenant-001");
        evt.Data.AssetCode.Should().Be("DV-001");
        evt.Data.DeviceType.Should().Be("Valve");
        evt.Data.HostPipeId.Should().Be("pipe-1");
        evt.Data.HostNodeId.Should().BeNull();
        evt.Data.Latitude.Should().Be(10.762622);
        evt.Data.Longitude.Should().Be(106.660172);
    }

    [Fact]
    public void Reconstitute_Does_Not_Raise_Events()
    {
        var device = NetworkDevice.Reconstitute(
            id: "device-abc",
            tenantId: "tenant-001",
            assetCode: new AssetCode("DV-001"),
            deviceType: DeviceType.Parse("Pump"),
            host: DeviceHost.For(DeviceType.Parse("Pump"), null, "node-1"),
            location: new GeoPoint(10.0, 106.0),
            version: 3,
            createdAt: DateTime.UtcNow.AddDays(-1),
            updatedAt: DateTime.UtcNow,
            deletedAt: null);

        device.DomainEvents.Should().BeEmpty();
        device.Version.Should().Be(3);
        device.DeviceType.ToString().Should().Be("Pump");
        device.Host.HostNodeId.Should().Be("node-1");
    }
}
```

(Lưu ý: nếu `AggregateRoot` expose danh sách event với tên khác `DomainEvents`, mở `NetworkPipeTests.cs` xem tên thật và dùng đúng tên đó — phần assert còn lại giữ nguyên.)

- [x] **Step 2: Chạy test xác nhận FAIL** (compile error).

Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`

- [x] **Step 3: Implement.**

`DeviceInstalled.cs` — mirror `PipeRegistered.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record DeviceInstalledData(
    string TenantId,
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude);

public sealed record DeviceInstalled(
    string AggregateId,
    DeviceInstalledData Data)
    : DomainEventBase<DeviceInstalledData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkDevice",
        eventType: "DeviceInstalled",
        data: Data);
```

`NetworkDevice.cs` — mirror `NetworkPipe.cs` (không có bất biến cục bộ thêm: host shape đã nằm trong `DeviceHost`, location đã nằm trong `GeoPoint`):

```csharp
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Aggregates;

public sealed class NetworkDevice : AggregateRoot
{
    public string TenantId { get; private set; }
    public AssetCode AssetCode { get; private set; }
    public DeviceType DeviceType { get; private set; }
    public DeviceHost Host { get; private set; }
    public GeoPoint Location { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    private NetworkDevice(
        string id,
        string tenantId,
        AssetCode assetCode,
        DeviceType deviceType,
        DeviceHost host,
        GeoPoint location,
        int version = 0,
        DateTime? createdAt = null,
        DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetCode = assetCode;
        DeviceType = deviceType;
        Host = host;
        Location = location;
    }

    public static NetworkDevice Install(
        string tenantId,
        AssetCode assetCode,
        DeviceType deviceType,
        DeviceHost host,
        GeoPoint location)
    {
        var device = new NetworkDevice(
            id: $"device-{Guid.CreateVersion7():N}",
            tenantId: tenantId,
            assetCode: assetCode,
            deviceType: deviceType,
            host: host,
            location: location);

        var data = new DeviceInstalledData(
            TenantId: tenantId,
            AssetCode: assetCode.Value,
            DeviceType: deviceType.ToString(),
            HostPipeId: host.HostPipeId,
            HostNodeId: host.HostNodeId,
            Latitude: location.Latitude,
            Longitude: location.Longitude);

        device.AddDomainEvent(new DeviceInstalled(device.Id, data));
        return device;
    }

    public static NetworkDevice Reconstitute(
        string id,
        string tenantId,
        AssetCode assetCode,
        DeviceType deviceType,
        DeviceHost host,
        GeoPoint location,
        int version,
        DateTime createdAt,
        DateTime updatedAt,
        DateTime? deletedAt = null)
        => new(id, tenantId, assetCode, deviceType, host, location, version, createdAt, updatedAt)
        {
            DeletedAt = deletedAt
        };
}
```

`INetworkDeviceRepository.cs` — mirror `INetworkPipeRepository` (mở file đó xem base interface, giữ đúng shape):

```csharp
using WaterNetwork.Gis.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface INetworkDeviceRepository : IAggregateRepository<NetworkDevice>
{
    Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default);
}
```

(Nếu `INetworkPipeRepository` khai báo khác — ví dụ tự khai `SaveAsync`/`GetByIdAsync` thay vì kế thừa `IAggregateRepository` — mirror đúng theo file đó.)

- [x] **Step 4: Chạy test xác nhận PASS.** Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`

- [x] **Step 5: Commit.**

```bash
git add src/services/water-network-gis-be
git commit -m "feat(gis): add NetworkDevice aggregate with DeviceInstalled event

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: `InstallDeviceCommand` + validator + handler (TDD, mock toàn bộ I/O)

**Files:**
- Create: `src/WaterNetwork.Gis.Application/Commands/InstallDeviceCommand.cs`
- Create: `src/WaterNetwork.Gis.Application/Commands/InstallDeviceCommandHandler.cs`
- Create: `src/WaterNetwork.Gis.Application/Validators/InstallDeviceCommandValidator.cs`
- Test: `tests/WaterNetwork.Gis.UnitTests/Application/InstallDeviceCommandHandlerTests.cs`, `InstallDeviceCommandValidatorTests.cs`

- [x] **Step 1: Tests trước.**

`InstallDeviceCommandValidatorTests`:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Validators;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class InstallDeviceCommandValidatorTests
{
    private readonly InstallDeviceCommandValidator _validator = new();

    private static InstallDeviceCommand Valid() => new(
        AssetCode: "DV-001",
        DeviceType: "Valve",
        HostPipeId: "pipe-1",
        HostNodeId: null,
        Latitude: 10.762622,
        Longitude: 106.660172);

    [Fact]
    public void Valid_Command_Passes()
        => _validator.Validate(Valid()).IsValid.Should().BeTrue();

    [Theory]
    [InlineData("")]
    [InlineData("has space")]
    public void Invalid_AssetCode_Fails(string code)
        => _validator.Validate(Valid() with { AssetCode = code }).IsValid.Should().BeFalse();

    [Fact]
    public void AssetCode_Over_64_Chars_Fails()
        => _validator.Validate(Valid() with { AssetCode = new string('a', 65) }).IsValid.Should().BeFalse();

    [Fact]
    public void Empty_DeviceType_Fails()
        => _validator.Validate(Valid() with { DeviceType = "" }).IsValid.Should().BeFalse();

    [Theory]
    [InlineData(-91)]
    [InlineData(91)]
    public void Latitude_Out_Of_Range_Fails(double lat)
        => _validator.Validate(Valid() with { Latitude = lat }).IsValid.Should().BeFalse();

    [Theory]
    [InlineData(-181)]
    [InlineData(181)]
    public void Longitude_Out_Of_Range_Fails(double lng)
        => _validator.Validate(Valid() with { Longitude = lng }).IsValid.Should().BeFalse();

    // Host shape KHÔNG validate ở đây — thuộc DeviceHost VO (quyết định spec #3).
    [Fact]
    public void Host_Shape_Is_Not_Validated_Here()
        => _validator.Validate(Valid() with { HostPipeId = null, HostNodeId = null })
            .IsValid.Should().BeTrue();
}
```

`InstallDeviceCommandHandlerTests` — mirror cấu trúc `RegisterPipeCommandHandlerTests`:

```csharp
using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class InstallDeviceCommandHandlerTests
{
    private readonly INetworkDeviceRepository _deviceRepo = Substitute.For<INetworkDeviceRepository>();
    private readonly INetworkPipeRepository _pipeRepo = Substitute.For<INetworkPipeRepository>();
    private readonly INetworkNodeRepository _nodeRepo = Substitute.For<INetworkNodeRepository>();
    private readonly ITenantContextAccessor _tenantAccessor = Substitute.For<ITenantContextAccessor>();

    private static NetworkNode MakeNode() =>
        NetworkNode.Register("tenant-001", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));

    private static NetworkPipe MakePipe() =>
        NetworkPipe.Register("tenant-001", new AssetCode("PP-1"), "node-a", "node-b",
            new PipeGeometry(new[] { new GeoPoint(10.0, 106.0), new GeoPoint(10.1, 106.1) }),
            new Diameter(100), PipeMaterial.Parse("HDPE"), 100.0, null);

    private InstallDeviceCommandHandler CreateHandler()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        _deviceRepo.SaveAsync(Arg.Any<NetworkDevice>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<NetworkDevice>());
        return new InstallDeviceCommandHandler(_deviceRepo, _pipeRepo, _nodeRepo, _tenantAccessor);
    }

    private static InstallDeviceCommand MakeCommand(
        string deviceType = "Valve", string? hostPipeId = "pipe-1", string? hostNodeId = null) =>
        new(AssetCode: "DV-001", DeviceType: deviceType,
            HostPipeId: hostPipeId, HostNodeId: hostNodeId,
            Latitude: 10.762622, Longitude: 106.660172);

    [Fact]
    public async Task Handle_ValveOnExistingPipe_SavesAndReturnsId()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        _pipeRepo.GetByIdAsync("pipe-1", Arg.Any<CancellationToken>()).Returns(MakePipe());

        var handler = CreateHandler();
        var id = await handler.HandleAsync(MakeCommand(), CancellationToken.None);

        id.Should().StartWith("device-");
        await _deviceRepo.Received(1).SaveAsync(
            Arg.Is<NetworkDevice>(d =>
                d.TenantId == "tenant-001"
                && d.AssetCode.Value == "DV-001"
                && d.Host.HostPipeId == "pipe-1"
                && d.Host.HostNodeId == null),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_PumpOnExistingNode_SavesAndReturnsId()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("node-1", Arg.Any<CancellationToken>()).Returns(MakeNode());

        var handler = CreateHandler();
        var id = await handler.HandleAsync(
            MakeCommand(deviceType: "Pump", hostPipeId: null, hostNodeId: "node-1"), CancellationToken.None);

        id.Should().StartWith("device-");
        await _pipeRepo.DidNotReceive().GetByIdAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_HostPipe_NotFound_Throws_BusinessRuleException()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        _pipeRepo.GetByIdAsync("pipe-1", Arg.Any<CancellationToken>()).Returns((NetworkPipe?)null);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkDevice.HostNotFound");
    }

    [Fact]
    public async Task Handle_HostNode_Deleted_Throws_BusinessRuleException()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        var deletedNode = NetworkNode.Reconstitute(
            id: "node-1", tenantId: "tenant-001", assetCode: new AssetCode("ND-DEL"),
            nodeType: NodeType.Junction, location: new GeoPoint(10.0, 106.0),
            version: 1, createdAt: DateTime.UtcNow.AddDays(-1), updatedAt: DateTime.UtcNow.AddDays(-1),
            deletedAt: DateTime.UtcNow);
        _nodeRepo.GetByIdAsync("node-1", Arg.Any<CancellationToken>()).Returns(deletedNode);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(
            MakeCommand(deviceType: "Hydrant", hostPipeId: null, hostNodeId: "node-1"), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkDevice.HostNotFound");
    }

    [Fact]
    public async Task Handle_InvalidHostShape_Throws_DomainException_Before_Repo_Lookup()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);

        var handler = CreateHandler();
        // Valve gửi kèm hostNodeId → DeviceHost.HostNotAllowed, KHÔNG gọi node/pipe repo
        var act = () => handler.HandleAsync(
            MakeCommand(hostPipeId: "pipe-1", hostNodeId: "node-1"), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<DomainException>();
        ex.Which.Code.Should().Contain("DeviceHost.HostNotAllowed");
        await _pipeRepo.DidNotReceive().GetByIdAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await _nodeRepo.DidNotReceive().GetByIdAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_DuplicateAssetCode_Throws_ConflictException()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(true);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<ConflictException>();
        ex.Which.Code.Should().Be("CONFLICT");
    }
}
```

(Lưu ý chữ ký `NetworkNode.Register`/`Reconstitute`/`SaveAsync` lấy đúng theo `RegisterPipeCommandHandlerTests` hiện có — nếu khác thì chỉnh phần dựng mock, giữ nguyên assertions.)

- [x] **Step 2: Chạy test xác nhận FAIL.** Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`

- [x] **Step 3: Implement.**

`InstallDeviceCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record InstallDeviceCommand(
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude) : ICommand<string>;
```

`InstallDeviceCommandValidator.cs`:

```csharp
using FluentValidation;
using WaterNetwork.Gis.Application.Commands;

namespace WaterNetwork.Gis.Application.Validators;

public sealed class InstallDeviceCommandValidator : AbstractValidator<InstallDeviceCommand>
{
    public InstallDeviceCommandValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.DeviceType).NotEmpty();

        RuleFor(x => x.Latitude)
            .InclusiveBetween(-90, 90).WithMessage("Latitude must be between -90 and 90.");
        RuleFor(x => x.Longitude)
            .InclusiveBetween(-180, 180).WithMessage("Longitude must be between -180 and 180.");

        // Host shape rules (per-deviceType matrix) live in the DeviceHost VO — not duplicated here.
    }
}
```

`InstallDeviceCommandHandler.cs`:

```csharp
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class InstallDeviceCommandHandler(
    INetworkDeviceRepository deviceRepository,
    INetworkPipeRepository pipeRepository,
    INetworkNodeRepository nodeRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<InstallDeviceCommand, string>
{
    public async Task<string> HandleAsync(InstallDeviceCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to install a device.");

        if (await deviceRepository.ExistsByAssetCodeAsync(tenant.TenantId, command.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkDevice", nameof(command.AssetCode), command.AssetCode);

        // Parse-first: host shape (400) is settled before any host-existence I/O (422).
        var deviceType = DeviceType.Parse(command.DeviceType);
        var host = DeviceHost.For(deviceType, command.HostPipeId, command.HostNodeId);

        if (host.HostPipeId is not null)
        {
            var pipe = await pipeRepository.GetByIdAsync(host.HostPipeId, ct);
            if (pipe is null || pipe.DeletedAt is not null)
                throw new BusinessRuleException(
                    "NetworkDevice.HostNotFound",
                    $"Pipe '{host.HostPipeId}' does not exist or has been deleted and cannot host a device.");
        }

        if (host.HostNodeId is not null)
        {
            var node = await nodeRepository.GetByIdAsync(host.HostNodeId, ct);
            if (node is null || node.DeletedAt is not null)
                throw new BusinessRuleException(
                    "NetworkDevice.HostNotFound",
                    $"Node '{host.HostNodeId}' does not exist or has been deleted and cannot host a device.");
        }

        var device = NetworkDevice.Install(
            tenantId: tenant.TenantId,
            assetCode: new AssetCode(command.AssetCode),
            deviceType: deviceType,
            host: host,
            location: new GeoPoint(command.Latitude, command.Longitude));

        await deviceRepository.SaveAsync(device, ct);
        return device.Id;
    }
}
```

- [x] **Step 4: Chạy test xác nhận PASS.** Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`

- [x] **Step 5: Commit.**

```bash
git add src/services/water-network-gis-be
git commit -m "feat(gis): add InstallDevice command pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Persistence — migration M3 `network_devices` + repository (integration test)

**Files:**
- Create: `src/WaterNetwork.Gis.Infrastructure/Persistence/NetworkDevicePersistenceModel.cs`
- Create: `src/WaterNetwork.Gis.Infrastructure/Persistence/Configurations/NetworkDeviceConfiguration.cs`
- Modify: `src/WaterNetwork.Gis.Infrastructure/Persistence/GisDbContext.cs` (thêm DbSet)
- Create: `src/WaterNetwork.Gis.Infrastructure/Repositories/NetworkDeviceRepository.cs`
- Create: migration `…_AddNetworkDevices.cs` (M3, generate bằng CLI)
- Modify: `src/WaterNetwork.Gis.Api/Program.cs` (DI)
- Test: `tests/WaterNetwork.Gis.IntegrationTests/NetworkDeviceRepositoryTests.cs`

- [x] **Step 1: Integration tests trước** — mở `NetworkPipeRepositoryTests.cs` hiện có, copy đúng cách dựng fixture/repository (PostgisFixture, DbContext, dispatcher/outbox), rồi viết các case sau (giữ nguyên assertions, chỉnh helper dựng repo cho khớp file mẫu):

```csharp
// NetworkDeviceRepositoryTests — các case bắt buộc:

// 1. Save → GetById round-trip giữ nguyên mọi field:
//    - Valve (HostPipeId set, HostNodeId null): assert Host.HostPipeId, Host.HostNodeId == null,
//      DeviceType.ToString() == "Valve", Location.Latitude/Longitude đúng từng giá trị
//      (chốt chặn thứ tự X=lng, Y=lat), AssetCode, TenantId, Version.
//    - Pump (HostNodeId set, HostPipeId null): assert chiều ngược lại.

// 2. Unique (tenant_id, asset_code): save 2 device cùng tenant cùng assetCode
//    → lần 2 ném ConflictException (mirror cách pipe test bắt UniqueViolation).

// 3. Optimistic concurrency: save device, Reconstitute với version cũ, save lại
//    → ConcurrencyException (mirror pipe test).

// 4. Tenant isolation: ExistsByAssetCodeAsync("tenant-B", code-của-tenant-A) → false.
```

- [x] **Step 2: Implement persistence.**

`NetworkDevicePersistenceModel.cs`:

```csharp
using NetTopologySuite.Geometries;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class NetworkDevicePersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string DeviceType { get; set; } = default!;
    public string? HostPipeId { get; set; }
    public string? HostNodeId { get; set; }
    public Point Location { get; set; } = default!;
    public string Status { get; set; } = "Active";
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}
```

`NetworkDeviceConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class NetworkDeviceConfiguration : IEntityTypeConfiguration<NetworkDevicePersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkDevicePersistenceModel> builder)
    {
        builder.ToTable("network_devices");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DeviceType).HasColumnName("device_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.HostPipeId).HasColumnName("host_pipe_id").HasMaxLength(64);
        builder.Property(x => x.HostNodeId).HasColumnName("host_node_id").HasMaxLength(64);
        builder.Property(x => x.Location).HasColumnName("location").HasColumnType("geometry(Point,4326)").IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("Active").IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");

        builder.HasIndex(x => new { x.TenantId, x.AssetCode }).IsUnique().HasDatabaseName("ux_network_devices_tenant_asset_code");
        builder.HasIndex(x => x.Location).HasMethod("gist").HasDatabaseName("ix_network_devices_location_gist");
        builder.HasIndex(x => new { x.TenantId, x.HostPipeId }).HasDatabaseName("ix_network_devices_host_pipe");
        builder.HasIndex(x => new { x.TenantId, x.HostNodeId }).HasDatabaseName("ix_network_devices_host_node");
        builder.HasQueryFilter(x => x.DeletedAt == null);
    }
}
```

`GisDbContext.cs` — thêm 1 dòng cạnh `NetworkPipes`:

```csharp
public DbSet<NetworkDevicePersistenceModel> NetworkDevices => Set<NetworkDevicePersistenceModel>();
```

`NetworkDeviceRepository.cs` — mirror `NetworkPipeRepository`:

```csharp
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class NetworkDeviceRepository(
    GisDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkDevice>(dbContext, eventDispatcher, outboxRepository), INetworkDeviceRepository
{
    public override async Task<NetworkDevice?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkDevices.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default)
        => await dbContext.NetworkDevices.AnyAsync(x => x.TenantId == tenantId && x.AssetCode == assetCode, ct);

    public override Task DeleteAsync(string id, CancellationToken ct = default)
    {
        // Device deletion is not supported until GIS-3 (SoftDelete).
        // Throwing here prevents the silent no-op from masking a caller bug.
        throw new NotSupportedException("Device deletion is not supported until GIS-3 (SoftDelete).");
    }

    protected override async Task PersistAsync(NetworkDevice aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.NetworkDevices.FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            if (expectedVersion > 0)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            }

            dbContext.NetworkDevices.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);
            }

            existing.AssetCode = aggregate.AssetCode.Value;
            existing.DeviceType = aggregate.DeviceType.ToString();
            existing.HostPipeId = aggregate.Host.HostPipeId;
            existing.HostNodeId = aggregate.Host.HostNodeId;
            existing.Location = ToPoint(aggregate.Location);
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            existing.DeletedAt = aggregate.DeletedAt;
        }
    }

    // Coordinate order in NTS: X = longitude, Y = latitude — mirrors NetworkPipeRepository.ToCoordinate.
    private static Point ToPoint(GeoPoint p) => new(p.Longitude, p.Latitude) { SRID = GeoPoint.Srid };

    private static NetworkDevicePersistenceModel ToModel(NetworkDevice device) => new()
    {
        Id = device.Id,
        TenantId = device.TenantId,
        AssetCode = device.AssetCode.Value,
        DeviceType = device.DeviceType.ToString(),
        HostPipeId = device.Host.HostPipeId,
        HostNodeId = device.Host.HostNodeId,
        Location = ToPoint(device.Location),
        Status = "Active",
        Version = device.Version,
        CreatedAt = device.CreatedAt,
        UpdatedAt = device.UpdatedAt,
        DeletedAt = device.DeletedAt
    };

    private static NetworkDevice ToDomain(NetworkDevicePersistenceModel model)
    {
        var deviceType = DeviceType.Parse(model.DeviceType);
        return NetworkDevice.Reconstitute(
            model.Id,
            model.TenantId,
            new AssetCode(model.AssetCode),
            deviceType,
            DeviceHost.For(deviceType, model.HostPipeId, model.HostNodeId),
            new GeoPoint(model.Location.Y, model.Location.X),   // Y = lat, X = lng
            model.Version,
            model.CreatedAt,
            model.UpdatedAt,
            model.DeletedAt);
    }
}
```

- [x] **Step 3: Generate migration M3.**

```bash
cd src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure
dotnet ef migrations add AddNetworkDevices
```

(DesignTimeFactory đã có từ GIS-1. Mở file migration sinh ra, đối chiếu với SQL dự kiến: bảng `network_devices`, unique + gist + 2 btree index như Configuration.)

- [x] **Step 4: Đăng ký DI trong `Program.cs`** — thêm cạnh dòng pipe:

```csharp
builder.Services.AddScoped<INetworkDeviceRepository, NetworkDeviceRepository>();
```

- [x] **Step 5: Chạy integration tests xác nhận PASS.**

Run: `dotnet test tests/WaterNetwork.Gis.IntegrationTests`
Expected: PASS (cả test node/pipe cũ — migration mới không đụng bảng cũ).

- [x] **Step 6: Commit.**

```bash
git add src/services/water-network-gis-be
git commit -m "feat(gis): persist network devices with PostGIS point

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: Contract `network.device.installed` v1 + refactor mapper registry (contract test trước)

**Files:**
- Create: `src/WaterNetwork.Gis.Contracts/Events/NetworkDeviceInstalledV1.cs`
- Modify: `src/WaterNetwork.Gis.Contracts/Events/GisEventTypes.cs`
- Modify: `src/WaterNetwork.Gis.Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs` (refactor registry + thêm event 3)
- Test: `tests/WaterNetwork.Gis.ContractTests/NetworkDeviceInstalledContractTests.cs`

- [x] **Step 1: Contract tests trước** — mirror `NetworkPipeRegisteredContractTests` (mở file đó copy style assert):

```csharp
// NetworkDeviceInstalledContractTests — các case bắt buộc:

// 1. Payload schema cố định: NetworkDeviceInstalledV1 có ĐÚNG các property
//    {DeviceId, TenantId, AssetCode, DeviceType, HostPipeId, HostNodeId, Latitude, Longitude}
//    (assert qua typeof(...).GetProperties() — mirror cách pipe contract test chốt schema).

// 2. GisEventTypes.DeviceInstalled == "network.device.installed".

// 3. Mapper: DeviceInstalled domain event (dựng qua NetworkDevice.Install) →
//    integration event có EventType == GisEventTypes.DeviceInstalled, EventVersion == 1,
//    SourceAggregateType == "NetworkDevice", Data đủ field (host null giữ null).

// 4. Regression: NodeRegistered và PipeRegistered VẪN map đúng type/version qua registry mới.

// 5. Event lạ (domain event không đăng ký) → Map trả null; CanMap("Unknown") == false;
//    CanMap("DeviceInstalled") == true.
```

- [x] **Step 2: Chạy test xác nhận FAIL.** Run: `dotnet test tests/WaterNetwork.Gis.ContractTests`

- [x] **Step 3: Implement.**

`NetworkDeviceInstalledV1.cs`:

```csharp
namespace WaterNetwork.Gis.Contracts.Events;

/// <summary>
/// v1 payload for the <c>network.device.installed</c> integration event.
/// Unlike pipe geometry, the device location (a single point) IS included —
/// it is cheap and most consumers (asset, observation, topology) want it.
/// Exactly one of <c>HostPipeId</c>/<c>HostNodeId</c> is non-null, enforced
/// upstream by the DeviceHost domain rule per device type.
/// </summary>
public sealed record NetworkDeviceInstalledV1(
    string DeviceId,
    string TenantId,
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude);
```

`GisEventTypes.cs` — thêm const:

```csharp
public const string DeviceInstalled = "network.device.installed";
```

`GisIntegrationEventMapper.cs` — refactor toàn bộ class sang registry (giữ nguyên 2 record integration event cũ, thêm record thứ 3):

```csharp
public sealed record DeviceInstalledIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkDeviceInstalledV1 Data)
    : IIntegrationEvent<NetworkDeviceInstalledV1>;

public sealed class GisIntegrationEventMapper : IIntegrationEventMapper
{
    // Registry thay cho if-chain (quyết định template-mapping §7.3 khi có event thứ 3).
    // Key = domain event type name (đúng chuỗi eventType mà DomainEventBase giữ).
    private static readonly IReadOnlyDictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>>(StringComparer.Ordinal)
        {
            ["NodeRegistered"] = e => e is NodeRegistered n ? MapNodeRegistered(n) : null,
            ["PipeRegistered"] = e => e is PipeRegistered p ? MapPipeRegistered(p) : null,
            ["DeviceInstalled"] = e => e is DeviceInstalled d ? MapDeviceInstalled(d) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    // MapNodeRegistered + MapPipeRegistered: GIỮ NGUYÊN body hiện có, không sửa.

    private static DeviceInstalledIntegrationEvent MapDeviceInstalled(DeviceInstalled domainEvent)
    {
        var d = domainEvent.Data;
        var data = new NetworkDeviceInstalledV1(
            DeviceId: domainEvent.AggregateId,
            TenantId: d.TenantId,
            AssetCode: d.AssetCode,
            DeviceType: d.DeviceType,
            HostPipeId: d.HostPipeId,
            HostNodeId: d.HostNodeId,
            Latitude: d.Latitude,
            Longitude: d.Longitude);

        return new DeviceInstalledIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.DeviceInstalled,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }
}
```

(Nếu `IDomainEvent` không expose `EventType`, dùng `domainEvent.GetType().Name` làm key — cùng chuỗi với 3 key trên. Kiểm tra `DomainEventBase`/`IDomainEvent` trong building-blocks trước khi chọn.)

- [x] **Step 4: Chạy contract tests xác nhận PASS** (cả regression node/pipe):

Run: `dotnet test tests/WaterNetwork.Gis.ContractTests`

- [x] **Step 5: Commit.**

```bash
git add src/services/water-network-gis-be
git commit -m "feat(gis): publish network.device.installed v1 via mapper registry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: API — `POST /api/network/devices`, `GET /api/network/devices/{id}` + E2E

**Files:**
- Create: `src/WaterNetwork.Gis.Contracts/Requests/InstallDeviceRequest.cs`
- Create: `src/WaterNetwork.Gis.Api/Validators/InstallDeviceRequestValidator.cs`
- Create: `src/WaterNetwork.Gis.Api/Endpoints/DevicesEndpointModule.cs`
- Create: `src/WaterNetwork.Gis.Application/Ports/IDeviceReadDao.cs`, `Dtos/DeviceDetailDto.cs`, `Queries/GetDeviceDetailQuery.cs`, `Queries/GetDeviceDetailQueryHandler.cs`
- Create: `src/WaterNetwork.Gis.Infrastructure/Repositories/DeviceReadDao.cs`
- Modify: `src/WaterNetwork.Gis.Api/Program.cs` (DI read dao)
- Test: `tests/WaterNetwork.Gis.IntegrationTests/InstallDeviceApiTests.cs`

- [x] **Step 1: E2E tests trước** — mirror `RegisterPipeApiTests` (copy `CreateAuthenticatedClient`; seed qua POST endpoints có sẵn). Lưu ý: case "host đã soft-delete → 422" KHÔNG nằm ở E2E (chưa có remove endpoint cho tới GIS-3, không seed được) — đã cover ở unit test handler Task 3 (`Handle_HostNode_Deleted_Throws_BusinessRuleException`).

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class InstallDeviceApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient CreateAuthenticatedClient(GisApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "test-user", tenantId: "tenant-001", permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> SeedNodeAsync(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16],
            nodeType = "Junction",
            latitude = 10.762622,
            longitude = 106.660172
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    private static async Task<string> SeedPipeAsync(HttpClient client)
    {
        var fromId = await SeedNodeAsync(client);
        var toId = await SeedNodeAsync(client);
        var resp = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = fromId,
            toNodeId = toId,
            points = new[]
            {
                new { lat = 10.762622, lng = 106.660172 },
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 100.0,
            material = "HDPE"
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    private static object DeviceBody(string assetCode, string deviceType,
        string? hostPipeId = null, string? hostNodeId = null) => new
    {
        assetCode,
        deviceType,
        hostPipeId,
        hostNodeId,
        latitude = 10.762700,
        longitude = 106.660500
    };

    [Fact]
    public async Task Install_Valve_On_Pipe_Returns_201_And_Get_Returns_All_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var code = $"DV-{Guid.NewGuid():N}"[..16];

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody(code, "Valve", hostPipeId: pipeId));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await response.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
        id.Should().StartWith("device-");
        response.Headers.Location!.ToString().Should().Contain(id);

        var detail = await client.GetAsync($"/api/network/devices/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await detail.Content.ReadFromJsonAsync<Dictionary<string, object>>();
        body!["id"].ToString().Should().Be(id);
        body["assetCode"].ToString().Should().Be(code);
        body["deviceType"].ToString().Should().Be("Valve");
        body["hostPipeId"].ToString().Should().Be(pipeId);
        body["latitude"].ToString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task Install_Pump_On_Node_Returns_201()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var nodeId = await SeedNodeAsync(client);
        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Pump", hostNodeId: nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Theory]
    [InlineData(true)]   // PressureSensor trên pipe
    [InlineData(false)]  // PressureSensor trên node
    public async Task Install_PressureSensor_On_Either_Host_Returns_201(bool onPipe)
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        string? pipeId = onPipe ? await SeedPipeAsync(client) : null;
        string? nodeId = onPipe ? null : await SeedNodeAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "PressureSensor", pipeId, nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Valve_Missing_HostPipe_Returns_400_DomainRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Valve"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("DOMAIN_RULE");
    }

    [Fact]
    public async Task Valve_With_HostNode_Returns_400_DomainRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var nodeId = await SeedNodeAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Valve", pipeId, nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("DOMAIN_RULE");
    }

    [Fact]
    public async Task PressureSensor_With_Both_Hosts_Returns_400_DomainRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var nodeId = await SeedNodeAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "PressureSensor", pipeId, nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("DOMAIN_RULE");
    }

    [Fact]
    public async Task Host_Pipe_Not_Found_Returns_422_BusinessRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Valve", hostPipeId: "pipe-does-not-exist"));

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("BUSINESS_RULE");
        body.Should().Contain("pipe-does-not-exist");
    }

    [Fact]
    public async Task Unknown_DeviceType_Returns_400_ValidationFailed()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Sprinkler", hostPipeId: "pipe-x"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Invalid_Latitude_Returns_400_ValidationFailed()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var response = await client.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Valve",
            hostPipeId = pipeId,
            hostNodeId = (string?)null,
            latitude = 99.0,
            longitude = 106.660500
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Duplicate_AssetCode_Returns_409()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var code = $"DV-{Guid.NewGuid():N}"[..16];

        (await client.PostAsJsonAsync("/api/network/devices", DeviceBody(code, "Valve", pipeId)))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        (await client.PostAsJsonAsync("/api/network/devices", DeviceBody(code, "Valve", pipeId)))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Successful_Post_Creates_Outbox_Message_With_Type_DeviceInstalled()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "FlowMeter", hostPipeId: pipeId));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var deviceId = (await response.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];

        using var scope = factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var outboxEntry = dbContext.OutboxEntries
            .FirstOrDefault(e => e.AggregateId == deviceId && e.EventType == "DeviceInstalled");
        outboxEntry.Should().NotBeNull();
        Guid.Parse(outboxEntry!.Id).Version.Should().Be(7,
            "outbox entry ids must be time-ordered uuid v7");
    }
}
```

- [x] **Step 2: Chạy E2E xác nhận FAIL** (404 vì endpoint chưa có):

Run: `dotnet test tests/WaterNetwork.Gis.IntegrationTests`

- [x] **Step 3: Implement.**

`InstallDeviceRequest.cs`:

```csharp
namespace WaterNetwork.Gis.Contracts.Requests;

public sealed record InstallDeviceRequest(
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude);
```

`InstallDeviceRequestValidator.cs` (Api assembly — đã được scan qua `AddValidatorsFromAssembly(typeof(Program).Assembly)`, template-mapping §7.4):

```csharp
using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class InstallDeviceRequestValidator : AbstractValidator<InstallDeviceRequest>
{
    public InstallDeviceRequestValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");

        // Delegate device-type validation to the Domain VO to avoid duplicating the catalog.
        RuleFor(x => x.DeviceType)
            .NotEmpty()
            .Must(t =>
            {
                try { DeviceType.Parse(t); return true; }
                catch (DomainException) { return false; }
            })
            .WithMessage("DeviceType must be one of: Valve, FlowMeter, PressureSensor, Pump, Hydrant.");

        RuleFor(x => x.HostPipeId).MaximumLength(64);
        RuleFor(x => x.HostNodeId).MaximumLength(64);

        RuleFor(x => x.Latitude)
            .InclusiveBetween(-90, 90).WithMessage("Latitude must be between -90 and 90.");
        RuleFor(x => x.Longitude)
            .InclusiveBetween(-180, 180).WithMessage("Longitude must be between -180 and 180.");

        // Host shape rules (per-deviceType matrix) are DOMAIN rules → DeviceHost VO → 400 DOMAIN_RULE.
    }
}
```

`DeviceDetailDto.cs`:

```csharp
namespace WaterNetwork.Gis.Application.Dtos;

public sealed record DeviceDetailDto(
    string Id,
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude,
    string Status,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);
```

`IDeviceReadDao.cs`:

```csharp
using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface IDeviceReadDao
{
    Task<DeviceDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
}
```

`GetDeviceDetailQuery.cs` + `GetDeviceDetailQueryHandler.cs` — mirror pipe:

```csharp
using WaterNetwork.Gis.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

public sealed record GetDeviceDetailQuery(string DeviceId) : IQuery<DeviceDetailDto?>;
```

```csharp
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class GetDeviceDetailQueryHandler(
    IDeviceReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetDeviceDetailQuery, DeviceDetailDto?>
{
    public Task<DeviceDetailDto?> HandleAsync(GetDeviceDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetByIdAsync(tenant.TenantId, query.DeviceId, ct);
    }
}
```

`DeviceReadDao.cs` — Dapper, point đọc bằng `ST_Y`/`ST_X` (không cần parse WKT như pipe):

```csharp
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class DeviceReadDao(GisDbContext dbContext) : IDeviceReadDao
{
    public async Task<DeviceDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id              AS Id,
                   asset_code      AS AssetCode,
                   device_type     AS DeviceType,
                   host_pipe_id    AS HostPipeId,
                   host_node_id    AS HostNodeId,
                   ST_Y(location)  AS Latitude,
                   ST_X(location)  AS Longitude,
                   status          AS Status,
                   version         AS Version,
                   created_at      AS CreatedAt,
                   updated_at      AS UpdatedAt
            FROM network_devices
            WHERE id = @id AND tenant_id = @tenantId AND deleted_at IS NULL
            """;

        var connection = dbContext.Database.GetDbConnection();
        return await connection.QuerySingleOrDefaultAsync<DeviceDetailDto>(
            new CommandDefinition(sql, new { id, tenantId }, cancellationToken: ct));
    }
}
```

`DevicesEndpointModule.cs`:

```csharp
using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Gis.Api.Endpoints;

public sealed class DevicesEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/network/devices");

        group.MapPost("/", async (InstallDeviceRequest request, ICommandBus commandBus, CancellationToken ct) =>
            {
                var id = await commandBus.ExecuteAsync(
                    new InstallDeviceCommand(
                        request.AssetCode,
                        request.DeviceType,
                        request.HostPipeId,
                        request.HostNodeId,
                        request.Latitude,
                        request.Longitude), ct);

                return Results.Created($"/api/network/devices/{id}", new { id });
            })
            .WithValidation<InstallDeviceRequest>()
            .RequirePermission("network-gis:write");

        group.MapGet("/{id}", async Task<Results<Ok<DeviceDetailDto>, NotFound>> (
                string id, IQueryBus queryBus, CancellationToken ct) =>
            {
                var device = await queryBus.ExecuteAsync(new GetDeviceDetailQuery(id), ct);
                return device is null ? TypedResults.NotFound() : TypedResults.Ok(device);
            })
            .RequirePermission("network-gis:read");
    }
}
```

`Program.cs` — thêm DI cạnh các dòng pipe:

```csharp
builder.Services.AddScoped<IDeviceReadDao, DeviceReadDao>();
```

- [x] **Step 4: Chạy toàn bộ test theo từng project xác nhận PASS.**

```bash
dotnet test tests/WaterNetwork.Gis.UnitTests
dotnet test tests/WaterNetwork.Gis.IntegrationTests
dotnet test tests/WaterNetwork.Gis.ContractTests
dotnet build WaterNetwork.Gis.slnx   # 0 warning
```

- [x] **Step 5: Commit.**

```bash
git add src/services/water-network-gis-be
git commit -m "feat(gis): expose device installation API (US-P1-03)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: Decision record + docs + chốt sổ slice

**Files:**
- Create: `docs/decisions/0009-api-route-prefix.md`
- Modify: `docs/conventions/template-mapping.md` (§7.3)
- Modify: `docs/stories/backlog.md`

- [x] **Step 1: Viết decision record** `docs/decisions/0009-api-route-prefix.md` (mirror format các decision có sẵn — mở 0008 xem header):

```markdown
# 0009 — API route prefix: giữ `/api/network/`, versioning thuộc gateway

- **Status:** accepted
- **Date:** 2026-06-13
- **Context:** Roadmap §4.4 viết route dạng `/api/v1/gis/...`, nhưng code hiện
  có (nodes, pipes từ GIS-1) dùng `/api/network/...` không version. Backlog yêu
  cầu chốt trước hoặc trong GIS-2.
- **Decision:** Service nội bộ expose route `/api/network/{resource}` và KHÔNG
  tự version. URL versioning (`/v1/`) là trách nhiệm của YARP gateway khi
  cross-cutting slice US-X triển khai; gateway map `/api/v1/network/*` →
  service route tương ứng. Payload versioning của integration events (EventVersion)
  không bị ảnh hưởng.
- **Consequences:** GIS-2+ và mọi service mới dùng `/api/{bounded-context}/{resource}`;
  đọc roadmap §4.4 theo decision này; follow-up versioning trong backlog đóng.
```

- [x] **Step 2: Update `docs/conventions/template-mapping.md` §7.3** — thay note "Migration note: if a third event kind is added..." bằng mô tả pattern registry mới (CanMap = `Registry.ContainsKey`, Map = `TryGetValue` + type-guard lambda, mỗi event một private static mapper).

- [x] **Step 3: Update `docs/stories/backlog.md`:**
  - Phase 1 status → `in progress (GIS-1, GIS-2 done)`.
  - Xóa 2 follow-up đã đóng (mapper registry — done Task 5; versioning prefix — done decision 0009), giữ ghi chú `dotnet test <slnx>` footgun.
  - Thêm follow-up mới: "Tenant check trên cross-aggregate refs (pipe endpoints + device hosts): handler hiện không verify host/endpoint thuộc cùng tenant — quyết định chung cho cả pipe lẫn device, cân nhắc ở GIS-3."

- [x] **Step 4: Chạy full test 2 solution** (building blocks + GIS, từng test project) — tất cả xanh, build 0 warning:

```bash
# từ repo root
dotnet build src/building-blocks/WaterPlatform.BuildingBlocks.slnx
dotnet build src/services/water-network-gis-be/WaterNetwork.Gis.slnx
# test từng project trong cả 2 solution (slnx footgun)
```

- [x] **Step 5: Commit cuối.**

```bash
git add docs
git commit -m "docs: close out GIS-2 InstallDevice slice

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [x] **Step 6:** Tick toàn bộ checkbox trong plan này + cập nhật checkbox/status nếu có thay đổi phát sinh. Invoke `superpowers:finishing-a-development-branch`.

## Rủi ro & lưu ý

- **Thứ tự tọa độ NTS**: `Point(X=lng, Y=lat)` — round-trip test ở Task 4 chốt chặn (mirror bug-class GIS-1 đã phòng).
- **Race duplicate asset code**: unique constraint là chốt cuối; `AggregateRepositoryBase` đã map `UniqueViolation` → `ConflictException` (pattern node/pipe).
- **Mapper registry**: key phải đúng chuỗi `eventType` của `DomainEventBase` (`"NodeRegistered"`, `"PipeRegistered"`, `"DeviceInstalled"`); regression test Task 5 chốt chặn cả 2 event cũ.
- **Host existence không khóa**: giữa lúc check host tồn tại và save, host có thể bị xóa (GIS-3 mới có remove) — chấp nhận ở Phase 1, GIS-3 sẽ thêm rule `*HasAttachedDevices` phía remove để chặn chiều ngược lại.
- **`dotnet test <slnx>` footgun**: luôn test theo từng project; build slnx chỉ để check 0 warning.
