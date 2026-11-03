# DSN-2 Draft Assets + Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `DesignRevision` (state machine Draft→Validated), `DraftNetworkAsset` (Node/Pipe/Device with PostGIS geometry), a validation engine, and create/update/validate/preview endpoints to `water-network-design-be`.

**Architecture:** `DesignRevision` is an outbox-backed aggregate (status + validation result + revision number). `DraftNetworkAsset` is a plain domain entity persisted via its own repository (no events — high churn). A pure-ish `DraftValidationService` (Application) computes a machine-readable `ValidationResult` from a revision's drafts plus one `IGisLookupPort` call (mock adapter in DSN-2). Geometry uses PostGIS + NetTopologySuite for the first time in design-be; the Domain stays NTS-free (coordinate VOs), NTS conversion happens in Application (validate `IsValid`) and Infrastructure (column mapping).

**Tech Stack:** .NET 10, EF Core + Npgsql + NetTopologySuite, PostGIS, FluentValidation, custom CQRS building blocks, xUnit + FluentAssertions + Testcontainers (PostgisFixture).

---

## Reference patterns (read before starting)

These existing files are the templates — match their style exactly:

- Aggregate: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Aggregates/DesignProject.cs`
- Aggregate repo (outbox): `…/WaterNetwork.Design.Infrastructure/Repositories/DesignProjectRepository.cs`
- Geometry repo + NTS conversion: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/NetworkPipeRepository.cs`
- Geometry EF config: `…/water-network-gis-be/…/Persistence/Configurations/NetworkPipeConfiguration.cs`
- jsonb column: `src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/Persistence/Configurations/AssetTechnicalProfileConfiguration.cs`
- NTS in DI: `…/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs:24` + `…/Persistence/DesignTimeGisDbContextFactory.cs`
- Endpoint module: `…/WaterNetwork.Design.Api/Endpoints/ProjectsEndpointModule.cs`
- Command handler: `…/WaterNetwork.Design.Application/Commands/CreateDesignProjectCommandHandler.cs`
- Integration test: `…/WaterNetwork.Design.IntegrationTests/DesignProjectApiTests.cs` + `DesignApiFactory.cs`
- Contract test: `…/WaterNetwork.Design.ContractTests/DesignProjectCreatedContractTests.cs`

**Spec:** `docs/superpowers/specs/2026-06-16-dsn2-draft-assets-validate-design.md`

**Test command (per the slnx footgun in backlog — run per-project, never the .slnx):**
```bash
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj
```

---

## Task 1: Domain value objects — geometry + status + kind

**Files:**
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/ValueObjects/DesignRevisionStatus.cs`
- Create: `…/Domain/ValueObjects/DraftAssetKind.cs`
- Create: `…/Domain/ValueObjects/DraftGeometryType.cs`
- Create: `…/Domain/ValueObjects/GeoCoordinate.cs`
- Create: `…/Domain/ValueObjects/DraftGeometry.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/DraftGeometryTests.cs`

- [x] **Step 1: Write the failing test**

```csharp
// DraftGeometryTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftGeometryTests
{
    [Fact]
    public void Point_Requires_Exactly_One_Coordinate()
    {
        var act = () => new DraftGeometry(DraftGeometryType.Point,
            new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.9, 21.1) });
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.PointArity");
    }

    [Fact]
    public void LineString_Requires_At_Least_Two_Coordinates()
    {
        var act = () => new DraftGeometry(DraftGeometryType.LineString,
            new[] { new GeoCoordinate(105.8, 21.0) });
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.LineStringArity");
    }

    [Fact]
    public void GeoCoordinate_Rejects_Out_Of_Range_Latitude()
    {
        var act = () => new GeoCoordinate(105.8, 999);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("GeoCoordinate.InvalidLatitude");
    }

    [Fact]
    public void Valid_Point_Is_Constructed()
    {
        var g = new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) });
        g.Type.Should().Be(DraftGeometryType.Point);
        g.Coordinates.Should().HaveCount(1);
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — `DraftGeometry`/`GeoCoordinate`/`DraftGeometryType` do not exist (compile error).

- [x] **Step 3: Write minimal implementation**

```csharp
// DesignRevisionStatus.cs
namespace WaterNetwork.Design.Domain.ValueObjects;

public enum DesignRevisionStatus
{
    Draft,
    Validated
}
```

```csharp
// DraftAssetKind.cs
namespace WaterNetwork.Design.Domain.ValueObjects;

public enum DraftAssetKind
{
    Node,
    Pipe,
    Device
}
```

```csharp
// DraftGeometryType.cs
namespace WaterNetwork.Design.Domain.ValueObjects;

public enum DraftGeometryType
{
    Point,
    LineString
}
```

```csharp
// GeoCoordinate.cs
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Design.Domain.ValueObjects;

public sealed class GeoCoordinate : ValueObject
{
    public const int Srid = 4326;

    public double Longitude { get; }
    public double Latitude { get; }

    public GeoCoordinate(double longitude, double latitude)
    {
        if (latitude is < -90 or > 90)
            throw new DomainException("GeoCoordinate.InvalidLatitude", $"Latitude {latitude} must be between -90 and 90.");
        if (longitude is < -180 or > 180)
            throw new DomainException("GeoCoordinate.InvalidLongitude", $"Longitude {longitude} must be between -180 and 180.");
        Longitude = longitude;
        Latitude = latitude;
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Longitude;
        yield return Latitude;
    }
}
```

```csharp
// DraftGeometry.cs
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Design.Domain.ValueObjects;

public sealed class DraftGeometry : ValueObject
{
    public DraftGeometryType Type { get; }
    public IReadOnlyList<GeoCoordinate> Coordinates { get; }

    public DraftGeometry(DraftGeometryType type, IReadOnlyList<GeoCoordinate> coordinates)
    {
        if (type == DraftGeometryType.Point && coordinates.Count != 1)
            throw new DomainException("DraftGeometry.PointArity", "A Point geometry requires exactly 1 coordinate.");
        if (type == DraftGeometryType.LineString && coordinates.Count < 2)
            throw new DomainException("DraftGeometry.LineStringArity", "A LineString geometry requires at least 2 coordinates.");

        Type = type;
        Coordinates = coordinates.ToList().AsReadOnly();
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Type;
        foreach (var c in Coordinates)
            yield return c;
    }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS (all DraftGeometryTests green).

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain/ValueObjects src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DraftGeometryTests.cs
git commit -m "feat(design): draft geometry + status value objects (DSN-2)"
```

---

## Task 2: Domain — ValidationResult value objects

**Files:**
- Create: `…/Domain/ValueObjects/ValidationIssue.cs`
- Create: `…/Domain/ValueObjects/ValidationResult.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/ValidationResultTests.cs`

- [x] **Step 1: Write the failing test**

```csharp
// ValidationResultTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class ValidationResultTests
{
    [Fact]
    public void HasErrors_Is_True_When_Any_Error_Present()
    {
        var result = new ValidationResult(
            new[] { new ValidationIssue("DuplicateAssetCode", "d1", null, "assetCode", "dup") },
            Array.Empty<ValidationIssue>());
        result.HasErrors.Should().BeTrue();
    }

    [Fact]
    public void Empty_Result_Has_No_Errors()
    {
        var result = ValidationResult.Empty;
        result.HasErrors.Should().BeFalse();
        result.Errors.Should().BeEmpty();
        result.Warnings.Should().BeEmpty();
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — `ValidationResult`/`ValidationIssue` do not exist.

- [x] **Step 3: Write minimal implementation**

```csharp
// ValidationIssue.cs
namespace WaterNetwork.Design.Domain.ValueObjects;

/// <summary>Machine-readable validation finding. Severity is implied by the list it lives in
/// (ValidationResult.Errors vs .Warnings).</summary>
public sealed record ValidationIssue(
    string Code,
    string? DraftAssetId,
    string? ClientRef,
    string? Field,
    string Message);
```

```csharp
// ValidationResult.cs
namespace WaterNetwork.Design.Domain.ValueObjects;

public sealed record ValidationResult(
    IReadOnlyList<ValidationIssue> Errors,
    IReadOnlyList<ValidationIssue> Warnings)
{
    public bool HasErrors => Errors.Count > 0;

    public static ValidationResult Empty { get; } =
        new(Array.Empty<ValidationIssue>(), Array.Empty<ValidationIssue>());
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain/ValueObjects/ValidationIssue.cs src/services/water-network-design-be/src/WaterNetwork.Design.Domain/ValueObjects/ValidationResult.cs src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/ValidationResultTests.cs
git commit -m "feat(design): validation result value objects (DSN-2)"
```

---

## Task 3: Domain — DesignRevision aggregate + events

**Files:**
- Create: `…/Domain/DomainEvents/DesignRevisionCreated.cs`
- Create: `…/Domain/DomainEvents/DesignRevisionValidated.cs`
- Create: `…/Domain/Aggregates/DesignRevision.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/DesignRevisionTests.cs`

- [x] **Step 1: Write the failing test**

```csharp
// DesignRevisionTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignRevisionTests
{
    [Fact]
    public void Create_Starts_In_Draft_And_Raises_Event()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.RevisionNumber.Should().Be(1);
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionCreated);
    }

    [Fact]
    public void ApplyValidation_With_No_Errors_Moves_To_Validated()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ClearDomainEvents();

        rev.ApplyValidation(ValidationResult.Empty);

        rev.Status.Should().Be(DesignRevisionStatus.Validated);
        rev.ValidationResult.Should().Be(ValidationResult.Empty);
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionValidated);
    }

    [Fact]
    public void ApplyValidation_With_Errors_Stays_Draft()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        var withError = new ValidationResult(
            new[] { new ValidationIssue("InvalidGeometry", "d1", null, "geometry", "bad") },
            Array.Empty<ValidationIssue>());

        rev.ApplyValidation(withError);

        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.ValidationResult!.HasErrors.Should().BeTrue();
    }

    [Fact]
    public void MarkDraftsChanged_Resets_Validated_To_Draft_And_Clears_Result()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty);
        rev.Status.Should().Be(DesignRevisionStatus.Validated);

        rev.MarkDraftsChanged();

        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.ValidationResult.Should().BeNull();
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — `DesignRevision` not found.

- [x] **Step 3: Write minimal implementation**

```csharp
// DesignRevisionCreated.cs
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionCreatedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber);

public sealed record DesignRevisionCreated(string AggregateId, DesignRevisionCreatedData Data)
    : DomainEventBase<DesignRevisionCreatedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionCreated",
        data: Data);
```

```csharp
// DesignRevisionValidated.cs
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionValidatedData(
    string ProjectId,
    string TenantId,
    int ErrorCount,
    int WarningCount,
    bool IsValid);

public sealed record DesignRevisionValidated(string AggregateId, DesignRevisionValidatedData Data)
    : DomainEventBase<DesignRevisionValidatedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionValidated",
        data: Data);
```

```csharp
// DesignRevision.cs
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Design.Domain.Aggregates;

public sealed class DesignRevision : AggregateRoot
{
    public string ProjectId { get; private set; }
    public string TenantId { get; private set; }
    public int RevisionNumber { get; private set; }
    public DesignRevisionStatus Status { get; private set; }
    public ValidationResult? ValidationResult { get; private set; }

    private DesignRevision(
        string id, string projectId, string tenantId, int revisionNumber,
        DesignRevisionStatus status, ValidationResult? validationResult,
        int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        ProjectId = projectId;
        TenantId = tenantId;
        RevisionNumber = revisionNumber;
        Status = status;
        ValidationResult = validationResult;
    }

    public static DesignRevision Create(string projectId, string tenantId, int revisionNumber)
    {
        var rev = new DesignRevision(
            Guid.CreateVersion7().ToString(), projectId, tenantId, revisionNumber,
            DesignRevisionStatus.Draft, validationResult: null);
        rev.MarkAsModified();
        rev.AddDomainEvent(new DesignRevisionCreated(
            rev.Id, new DesignRevisionCreatedData(projectId, tenantId, revisionNumber)));
        return rev;
    }

    public void ApplyValidation(ValidationResult result)
    {
        ValidationResult = result;
        Status = result.HasErrors ? DesignRevisionStatus.Draft : DesignRevisionStatus.Validated;
        MarkAsModified();
        AddDomainEvent(new DesignRevisionValidated(Id, new DesignRevisionValidatedData(
            ProjectId, TenantId, result.Errors.Count, result.Warnings.Count, !result.HasErrors)));
    }

    /// <summary>Any draft mutation invalidates a previously-Validated revision.</summary>
    public void MarkDraftsChanged()
    {
        if (Status != DesignRevisionStatus.Validated) return;
        Status = DesignRevisionStatus.Draft;
        ValidationResult = null;
        MarkAsModified();
    }

    public static DesignRevision Reconstitute(
        string id, string projectId, string tenantId, int revisionNumber,
        DesignRevisionStatus status, ValidationResult? validationResult,
        int version, DateTime createdAt, DateTime updatedAt)
        => new(id, projectId, tenantId, revisionNumber, status, validationResult, version, createdAt, updatedAt);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Aggregates/DesignRevision.cs src/services/water-network-design-be/src/WaterNetwork.Design.Domain/DomainEvents/DesignRevisionCreated.cs src/services/water-network-design-be/src/WaterNetwork.Design.Domain/DomainEvents/DesignRevisionValidated.cs src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DesignRevisionTests.cs
git commit -m "feat(design): DesignRevision aggregate + state machine (DSN-2)"
```

---

## Task 4: Domain — DraftNetworkAsset entity

**Files:**
- Create: `…/Domain/Entities/DraftNetworkAsset.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/DraftNetworkAssetTests.cs`

- [x] **Step 1: Write the failing test**

```csharp
// DraftNetworkAssetTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftNetworkAssetTests
{
    private static DraftGeometry Point() =>
        new(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) });

    [Fact]
    public void Create_Populates_Fields_And_Generates_Id()
    {
        var d = DraftNetworkAsset.Create(
            "rev-1", "tenant-1", DraftAssetKind.Node, "N-001", clientRef: "c1",
            geometry: Point(), attributes: new Dictionary<string, string> { ["nodeType"] = "Junction" },
            fromRef: null, toRef: null, hostRef: null);

        d.Id.Should().NotBeNullOrEmpty();
        d.RevisionId.Should().Be("rev-1");
        d.Kind.Should().Be(DraftAssetKind.Node);
        d.AssetCode.Should().Be("N-001");
        d.ClientRef.Should().Be("c1");
        d.Attributes.Should().ContainKey("nodeType");
    }

    [Fact]
    public void UpdateGeometry_Replaces_Geometry()
    {
        var d = DraftNetworkAsset.Create(
            "rev-1", "tenant-1", DraftAssetKind.Node, "N-001", null, Point(),
            new Dictionary<string, string>(), null, null, null);

        var newGeom = new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(106.0, 20.5) });
        d.UpdateGeometry(newGeom);

        d.Geometry.Coordinates[0].Longitude.Should().Be(106.0);
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — `DraftNetworkAsset` not found.

- [x] **Step 3: Write minimal implementation**

```csharp
// DraftNetworkAsset.cs
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Design.Domain.Entities;

/// <summary>A draft asset belonging to a DesignRevision. Plain entity (no domain events —
/// high-churn during import); persisted via IDraftNetworkAssetRepository.</summary>
public sealed class DraftNetworkAsset : Entity
{
    public string RevisionId { get; private set; }
    public string TenantId { get; private set; }
    public DraftAssetKind Kind { get; private set; }
    public string AssetCode { get; private set; }
    public string? ClientRef { get; private set; }
    public DraftGeometry Geometry { get; private set; }
    public IReadOnlyDictionary<string, string> Attributes { get; private set; }
    public string? FromRef { get; private set; }
    public string? ToRef { get; private set; }
    public string? HostRef { get; private set; }

    private DraftNetworkAsset(
        string id, string revisionId, string tenantId, DraftAssetKind kind, string assetCode,
        string? clientRef, DraftGeometry geometry, IReadOnlyDictionary<string, string> attributes,
        string? fromRef, string? toRef, string? hostRef,
        DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, createdAt, updatedAt)
    {
        RevisionId = revisionId;
        TenantId = tenantId;
        Kind = kind;
        AssetCode = assetCode;
        ClientRef = clientRef;
        Geometry = geometry;
        Attributes = attributes;
        FromRef = fromRef;
        ToRef = toRef;
        HostRef = hostRef;
    }

    public static DraftNetworkAsset Create(
        string revisionId, string tenantId, DraftAssetKind kind, string assetCode, string? clientRef,
        DraftGeometry geometry, IReadOnlyDictionary<string, string> attributes,
        string? fromRef, string? toRef, string? hostRef)
        => new(Guid.CreateVersion7().ToString(), revisionId, tenantId, kind, assetCode, clientRef,
            geometry, attributes, fromRef, toRef, hostRef);

    public void UpdateGeometry(DraftGeometry geometry)
    {
        Geometry = geometry;
        UpdatedAt = DateTime.UtcNow;
    }

    public static DraftNetworkAsset Reconstitute(
        string id, string revisionId, string tenantId, DraftAssetKind kind, string assetCode,
        string? clientRef, DraftGeometry geometry, IReadOnlyDictionary<string, string> attributes,
        string? fromRef, string? toRef, string? hostRef, DateTime createdAt, DateTime updatedAt)
        => new(id, revisionId, tenantId, kind, assetCode, clientRef, geometry, attributes,
            fromRef, toRef, hostRef, createdAt, updatedAt);
}
```

> Note: `Entity.UpdatedAt` has a `protected set`, so `UpdateGeometry` can assign it.

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Entities/DraftNetworkAsset.cs src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DraftNetworkAssetTests.cs
git commit -m "feat(design): DraftNetworkAsset entity (DSN-2)"
```

---

## Task 5: Domain — repository interfaces

**Files:**
- Create: `…/Domain/Repositories/IDesignRevisionRepository.cs`
- Create: `…/Domain/Repositories/IDraftNetworkAssetRepository.cs`

No test (interfaces only — exercised by handler tests in later tasks).

- [x] **Step 1: Write the interfaces**

```csharp
// IDesignRevisionRepository.cs
using WaterNetwork.Design.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDesignRevisionRepository : IAggregateRepository<DesignRevision>
{
    Task<int> GetNextRevisionNumberAsync(string tenantId, string projectId, CancellationToken ct = default);
}
```

```csharp
// IDraftNetworkAssetRepository.cs
using WaterNetwork.Design.Domain.Entities;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDraftNetworkAssetRepository
{
    Task AddAsync(DraftNetworkAsset draft, CancellationToken ct = default);
    Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> drafts, CancellationToken ct = default);
    Task<DraftNetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
    Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(string tenantId, string revisionId, CancellationToken ct = default);
    Task UpdateAsync(DraftNetworkAsset draft, CancellationToken ct = default);
}
```

- [x] **Step 2: Build to verify it compiles**

Run: `dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Domain/WaterNetwork.Design.Domain.csproj`
Expected: Build succeeded, 0 warnings.

- [x] **Step 3: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Repositories
git commit -m "feat(design): revision + draft repository interfaces (DSN-2)"
```

---

## Task 6: Application — IGisLookupPort + geometry conversion helper

**Files:**
- Create: `…/Application/Ports/IGisLookupPort.cs`
- Create: `…/Application/Geometry/NtsGeometryConverter.cs`
- Add NTS package reference to `…/WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj`
- Test: `…/tests/WaterNetwork.Design.UnitTests/NtsGeometryConverterTests.cs`

- [x] **Step 1: Add NetTopologySuite reference to Application csproj**

In `src/services/water-network-design-be/src/WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj`, inside the existing `<ItemGroup>` containing `<PackageReference>` entries, add:

```xml
    <PackageReference Include="NetTopologySuite" />
```

(Version is centrally managed in `Directory.Packages.props` — do not specify it here.)

- [x] **Step 2: Write the failing test**

```csharp
// NtsGeometryConverterTests.cs
using FluentAssertions;
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class NtsGeometryConverterTests
{
    [Fact]
    public void Point_Converts_With_Srid_4326_And_Lng_Lat_Order()
    {
        var g = new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) });
        var nts = NtsGeometryConverter.ToNts(g);
        nts.Should().BeOfType<Point>();
        nts.SRID.Should().Be(4326);
        nts.Coordinate.X.Should().Be(105.8); // X = longitude
        nts.Coordinate.Y.Should().Be(21.0);  // Y = latitude
    }

    [Fact]
    public void LineString_Converts_All_Coordinates()
    {
        var g = new DraftGeometry(DraftGeometryType.LineString,
            new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.9, 21.1) });
        var nts = NtsGeometryConverter.ToNts(g);
        nts.Should().BeOfType<LineString>();
        nts.Coordinates.Should().HaveCount(2);
    }
}
```

- [x] **Step 3: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — `NtsGeometryConverter`/`IGisLookupPort` not found.

- [x] **Step 4: Write minimal implementation**

```csharp
// IGisLookupPort.cs
namespace WaterNetwork.Design.Application.Ports;

/// <summary>Read-only lookup into the GIS service used during draft validation.
/// DSN-2 ships a mock adapter; a real HTTP adapter swaps in later via config.</summary>
public interface IGisLookupPort
{
    Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct = default);
}
```

```csharp
// NtsGeometryConverter.cs
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.Application.Geometry;

/// <summary>Converts a Domain <see cref="DraftGeometry"/> (NTS-free) into a NetTopologySuite
/// geometry (SRID 4326, X=longitude, Y=latitude — matching gis-be).</summary>
public static class NtsGeometryConverter
{
    private static readonly GeometryFactory Factory =
        NtsGeometryServices.Instance.CreateGeometryFactory(GeoCoordinate.Srid);

    public static NetTopologySuite.Geometries.Geometry ToNts(DraftGeometry geometry) => geometry.Type switch
    {
        DraftGeometryType.Point => Factory.CreatePoint(ToCoordinate(geometry.Coordinates[0])),
        DraftGeometryType.LineString => Factory.CreateLineString(
            geometry.Coordinates.Select(ToCoordinate).ToArray()),
        _ => throw new ArgumentOutOfRangeException(nameof(geometry), geometry.Type, "Unknown geometry type.")
    };

    private static Coordinate ToCoordinate(GeoCoordinate c) => new(c.Longitude, c.Latitude);
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Ports/IGisLookupPort.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Geometry/NtsGeometryConverter.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/NtsGeometryConverterTests.cs
git commit -m "feat(design): GIS lookup port + NTS geometry converter (DSN-2)"
```

---

## Task 7: Application — DraftValidationService (the validation engine)

This is the core of DSN-2. The service takes a revision's drafts + the GIS lookup port and returns a `ValidationResult`.

**Files:**
- Create: `…/Application/Services/IDraftValidationService.cs`
- Create: `…/Application/Services/DraftValidationService.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/DraftValidationServiceTests.cs`

- [x] **Step 1: Write the failing test**

```csharp
// DraftValidationServiceTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftValidationServiceTests
{
    private sealed class FakeGisLookup(params string[] existing) : IGisLookupPort
    {
        public Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct = default)
            => Task.FromResult(existing.Contains(assetCode));
    }

    private static DraftGeometry Point(double lng = 105.8, double lat = 21.0) =>
        new(DraftGeometryType.Point, new[] { new GeoCoordinate(lng, lat) });

    private static DraftGeometry Line() => new(DraftGeometryType.LineString,
        new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.9, 21.1) });

    private static DraftNetworkAsset Node(string code, string? clientRef = null) =>
        DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Node, code, clientRef, Point(),
            new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    private static DraftNetworkAsset Pipe(string code, string from, string to,
        Dictionary<string, string>? attrs = null) =>
        DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Pipe, code, null, Line(),
            attrs ?? new Dictionary<string, string> { ["diameterMm"] = "100", ["material"] = "PVC" },
            from, to, null);

    private readonly DraftValidationService _sut = new();

    [Fact]
    public async Task Valid_Drafts_Produce_No_Errors()
    {
        var drafts = new[] { Node("N-1", "c-n1"), Pipe("P-1", "c-n1", "c-n1b"), Node("N-2", "c-n1b") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.HasErrors.Should().BeFalse();
    }

    [Fact]
    public async Task Duplicate_Asset_Code_In_Revision_Is_Error()
    {
        var drafts = new[] { Node("DUP"), Node("DUP") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "DuplicateAssetCode");
    }

    [Fact]
    public async Task Asset_Code_Existing_In_Gis_Is_Error()
    {
        var drafts = new[] { Node("N-1") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup("N-1"), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "AssetCodeExistsInGis");
    }

    [Fact]
    public async Task Pipe_Endpoint_Not_Resolving_To_Node_Is_Error()
    {
        var drafts = new[] { Pipe("P-1", "missing-from", "missing-to") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "PipeEndpointMissing");
    }

    [Fact]
    public async Task Pipe_Missing_Diameter_Is_Error()
    {
        var pipe = Pipe("P-1", "c-n1", "c-n1b", new Dictionary<string, string> { ["material"] = "PVC" });
        var drafts = new[] { Node("N-1", "c-n1"), Node("N-2", "c-n1b"), pipe };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "MissingRequiredAttribute" && e.Field == "diameterMm");
    }

    [Fact]
    public async Task Node_Missing_NodeType_Is_Error()
    {
        var node = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Node, "N-1", null, Point(),
            new Dictionary<string, string>(), null, null, null);
        var result = await _sut.ValidateAsync("t1", new[] { node }, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "MissingRequiredAttribute" && e.Field == "nodeType");
    }

    [Fact]
    public async Task Valve_Device_Without_Pipe_Host_Is_Error()
    {
        var node = Node("N-1", "c-n1");
        var device = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Device, "D-1", null, Point(),
            new Dictionary<string, string> { ["deviceType"] = "Valve" }, null, null, hostRef: "c-n1");
        var result = await _sut.ValidateAsync("t1", new[] { node, device }, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "InvalidDeviceHost");
    }

    [Fact]
    public async Task Degenerate_LineString_Is_Invalid_Geometry()
    {
        // 2 identical points → NTS IsValid = false (zero-length).
        var badLine = new DraftGeometry(DraftGeometryType.LineString,
            new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.8, 21.0) });
        var pipe = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Pipe, "P-1", null, badLine,
            new Dictionary<string, string> { ["diameterMm"] = "100", ["material"] = "PVC" },
            "c-n1", "c-n1b", null);
        var drafts = new[] { Node("N-1", "c-n1"), Node("N-2", "c-n1b"), pipe };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "InvalidGeometry");
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — `IDraftValidationService`/`DraftValidationService` not found.

- [x] **Step 3: Write minimal implementation**

```csharp
// IDraftValidationService.cs
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.Application.Services;

public interface IDraftValidationService
{
    Task<ValidationResult> ValidateAsync(
        string tenantId,
        IReadOnlyList<DraftNetworkAsset> drafts,
        IGisLookupPort gisLookup,
        CancellationToken ct);
}
```

```csharp
// DraftValidationService.cs
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.Application.Services;

public sealed class DraftValidationService : IDraftValidationService
{
    private static readonly HashSet<string> ValveLikeNeedingPipe = new(StringComparer.OrdinalIgnoreCase)
        { "Valve", "FlowMeter" };
    private static readonly HashSet<string> NodeHostDevices = new(StringComparer.OrdinalIgnoreCase)
        { "Pump", "Hydrant" };

    public async Task<ValidationResult> ValidateAsync(
        string tenantId, IReadOnlyList<DraftNetworkAsset> drafts, IGisLookupPort gisLookup, CancellationToken ct)
    {
        var errors = new List<ValidationIssue>();
        var warnings = new List<ValidationIssue>();

        // Index drafts by both clientRef and id so cross-references resolve either way.
        var byRef = new Dictionary<string, DraftNetworkAsset>(StringComparer.Ordinal);
        foreach (var d in drafts)
        {
            byRef[d.Id] = d;
            if (!string.IsNullOrWhiteSpace(d.ClientRef)) byRef[d.ClientRef] = d;
        }

        // Rule: duplicate asset code within the revision.
        foreach (var group in drafts.GroupBy(d => d.AssetCode, StringComparer.Ordinal).Where(g => g.Count() > 1))
            foreach (var d in group)
                errors.Add(new ValidationIssue("DuplicateAssetCode", d.Id, d.ClientRef, "assetCode",
                    $"Asset code '{group.Key}' is used by more than one draft in this revision."));

        foreach (var d in drafts)
        {
            // Rule: asset code already exists in GIS.
            if (await gisLookup.AssetCodeExists(tenantId, d.AssetCode, ct))
                errors.Add(new ValidationIssue("AssetCodeExistsInGis", d.Id, d.ClientRef, "assetCode",
                    $"Asset code '{d.AssetCode}' already exists in GIS."));

            // Rule: geometry must be valid per NTS (catches self-intersection / zero-length).
            var nts = NtsGeometryConverter.ToNts(d.Geometry);
            if (!nts.IsValid)
                errors.Add(new ValidationIssue("InvalidGeometry", d.Id, d.ClientRef, "geometry",
                    "Geometry is not OGC-valid."));

            switch (d.Kind)
            {
                case DraftAssetKind.Node:
                    RequireAttr(d, "nodeType", errors);
                    break;

                case DraftAssetKind.Pipe:
                    ValidatePipe(d, byRef, errors);
                    break;

                case DraftAssetKind.Device:
                    ValidateDevice(d, byRef, errors);
                    break;
            }
        }

        return new ValidationResult(errors, warnings);
    }

    private static void ValidatePipe(
        DraftNetworkAsset pipe, IReadOnlyDictionary<string, DraftNetworkAsset> byRef, List<ValidationIssue> errors)
    {
        EndpointMustBeNode(pipe, pipe.FromRef, "fromRef", byRef, errors);
        EndpointMustBeNode(pipe, pipe.ToRef, "toRef", byRef, errors);

        if (!HasPositiveInt(pipe.Attributes, "diameterMm"))
            errors.Add(new ValidationIssue("MissingRequiredAttribute", pipe.Id, pipe.ClientRef, "diameterMm",
                "Pipe requires attribute 'diameterMm' as a positive integer."));
        RequireAttr(pipe, "material", errors);
    }

    private static void EndpointMustBeNode(
        DraftNetworkAsset pipe, string? endpointRef, string field,
        IReadOnlyDictionary<string, DraftNetworkAsset> byRef, List<ValidationIssue> errors)
    {
        if (string.IsNullOrWhiteSpace(endpointRef) ||
            !byRef.TryGetValue(endpointRef, out var target) || target.Kind != DraftAssetKind.Node)
        {
            errors.Add(new ValidationIssue("PipeEndpointMissing", pipe.Id, pipe.ClientRef, field,
                $"Pipe {field} '{endpointRef}' does not resolve to a draft node in this revision."));
        }
    }

    private static void ValidateDevice(
        DraftNetworkAsset device, IReadOnlyDictionary<string, DraftNetworkAsset> byRef, List<ValidationIssue> errors)
    {
        if (!device.Attributes.TryGetValue("deviceType", out var deviceType) || string.IsNullOrWhiteSpace(deviceType))
        {
            errors.Add(new ValidationIssue("MissingRequiredAttribute", device.Id, device.ClientRef, "deviceType",
                "Device requires attribute 'deviceType'."));
            return;
        }

        var host = device.HostRef is not null && byRef.TryGetValue(device.HostRef, out var h) ? h : null;
        var hostKind = host?.Kind;

        bool ok = deviceType switch
        {
            _ when ValveLikeNeedingPipe.Contains(deviceType) => hostKind == DraftAssetKind.Pipe,
            "PressureSensor" => hostKind is DraftAssetKind.Pipe or DraftAssetKind.Node,
            _ when NodeHostDevices.Contains(deviceType) => hostKind == DraftAssetKind.Node,
            _ => true // unknown device type → no host rule enforced (treated as valid here)
        };

        if (!ok)
            errors.Add(new ValidationIssue("InvalidDeviceHost", device.Id, device.ClientRef, "hostRef",
                $"Device type '{deviceType}' has an invalid or missing host reference."));
    }

    private static void RequireAttr(DraftNetworkAsset d, string key, List<ValidationIssue> errors)
    {
        if (!d.Attributes.TryGetValue(key, out var v) || string.IsNullOrWhiteSpace(v))
            errors.Add(new ValidationIssue("MissingRequiredAttribute", d.Id, d.ClientRef, key,
                $"Required attribute '{key}' is missing."));
    }

    private static bool HasPositiveInt(IReadOnlyDictionary<string, string> attrs, string key)
        => attrs.TryGetValue(key, out var raw) && int.TryParse(raw, out var n) && n > 0;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS (all 9 DraftValidationServiceTests green).

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Services src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DraftValidationServiceTests.cs
git commit -m "feat(design): draft validation engine (DSN-2)"
```

---

## Task 8: Application — geometry input DTO + factory

A shared Application-level shape for geometry coming from the API, plus a factory that builds the Domain `DraftGeometry` (throws `DomainException` → mapped to 400 by the platform exception handler).

**Files:**
- Create: `…/Application/Geometry/DraftGeometryInput.cs`
- Create: `…/Application/Geometry/DraftGeometryFactory.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/DraftGeometryFactoryTests.cs`

- [x] **Step 1: Write the failing test**

```csharp
// DraftGeometryFactoryTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftGeometryFactoryTests
{
    [Fact]
    public void Builds_Point_From_Single_Coordinate_Pair()
    {
        var input = new DraftGeometryInput("Point", new[] { new[] { 105.8, 21.0 } });
        var g = DraftGeometryFactory.FromInput(input);
        g.Type.Should().Be(DraftGeometryType.Point);
        g.Coordinates[0].Longitude.Should().Be(105.8);
    }

    [Fact]
    public void Unknown_Type_Throws_DomainException()
    {
        var input = new DraftGeometryInput("Polygon", new[] { new[] { 105.8, 21.0 } });
        var act = () => DraftGeometryFactory.FromInput(input);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.UnknownType");
    }

    [Fact]
    public void Coordinate_Pair_Of_Wrong_Length_Throws()
    {
        var input = new DraftGeometryInput("Point", new[] { new[] { 105.8 } });
        var act = () => DraftGeometryFactory.FromInput(input);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.BadCoordinate");
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — types not found.

- [x] **Step 3: Write minimal implementation**

```csharp
// DraftGeometryInput.cs
namespace WaterNetwork.Design.Application.Geometry;

/// <summary>GeoJSON-shaped geometry input: Type is "Point" or "LineString"; Coordinates is a
/// list of [longitude, latitude] pairs (one for Point, two-or-more for LineString).</summary>
public sealed record DraftGeometryInput(string Type, IReadOnlyList<IReadOnlyList<double>> Coordinates);
```

```csharp
// DraftGeometryFactory.cs
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.Application.Geometry;

public static class DraftGeometryFactory
{
    public static DraftGeometry FromInput(DraftGeometryInput input)
    {
        var type = input.Type switch
        {
            "Point" => DraftGeometryType.Point,
            "LineString" => DraftGeometryType.LineString,
            _ => throw new DomainException("DraftGeometry.UnknownType",
                $"Geometry type '{input.Type}' is not supported (use Point or LineString).")
        };

        var coords = new List<GeoCoordinate>(input.Coordinates.Count);
        foreach (var pair in input.Coordinates)
        {
            if (pair.Count != 2)
                throw new DomainException("DraftGeometry.BadCoordinate",
                    "Each coordinate must be a [longitude, latitude] pair.");
            coords.Add(new GeoCoordinate(pair[0], pair[1]));
        }

        return new DraftGeometry(type, coords);
    }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Geometry/DraftGeometryInput.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Geometry/DraftGeometryFactory.cs src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DraftGeometryFactoryTests.cs
git commit -m "feat(design): geometry input DTO + factory (DSN-2)"
```

---

## Task 9: Application — CreateDesignRevision command + handler

**Files:**
- Create: `…/Application/Commands/CreateDesignRevisionCommand.cs`
- Create: `…/Application/Commands/CreateDesignRevisionCommandHandler.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/CreateDesignRevisionTests.cs`

The handler verifies the project exists in the caller's tenant (404 via `NotFoundException`), gets the next revision number, creates the revision, and persists it.

- [x] **Step 1: Write the failing test**

```csharp
// CreateDesignRevisionTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class CreateDesignRevisionTests
{
    private sealed class FakeProjects(bool exists) : IDesignProjectReadDao
    {
        public Task<DesignProjectDetailDto?> GetDetailAsync(string t, string p, CancellationToken ct = default)
            => Task.FromResult<DesignProjectDetailDto?>(null);
        public Task<bool> ExistsAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(exists);
    }

    private sealed class FakeRevisions(int next) : IDesignRevisionRepository
    {
        public DesignRevision? Saved { get; private set; }
        public Task<int> GetNextRevisionNumberAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(next);
        public Task<DesignRevision> SaveAsync(DesignRevision a, CancellationToken ct = default) { Saved = a; return Task.FromResult(a); }
        public Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default) => Task.FromResult<DesignRevision?>(null);
        public Task DeleteAsync(string id, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FixedTenant : ITenantContextAccessor
    {
        public TenantContext? Current => new("tenant-1");
    }

    [Fact]
    public async Task Creates_Revision_With_Next_Number()
    {
        var revisions = new FakeRevisions(next: 3);
        var handler = new CreateDesignRevisionCommandHandler(new FakeProjects(true), revisions, new FixedTenant());

        var id = await handler.HandleAsync(new CreateDesignRevisionCommand("proj-1"), CancellationToken.None);

        id.Should().NotBeNullOrEmpty();
        revisions.Saved!.RevisionNumber.Should().Be(3);
        revisions.Saved.ProjectId.Should().Be("proj-1");
    }

    [Fact]
    public async Task Missing_Project_Throws_NotFound()
    {
        var handler = new CreateDesignRevisionCommandHandler(new FakeProjects(false), new FakeRevisions(1), new FixedTenant());
        var act = () => handler.HandleAsync(new CreateDesignRevisionCommand("nope"), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }
}
```

> Confirm the `TenantContext` constructor shape against `WaterPlatform.BuildingBlocks.MultiTenancy.TenantContext` (used in `CreateDesignProjectCommandHandler`); adjust `new TenantContext("tenant-1")` if its signature differs.

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — command/handler not found.

- [x] **Step 3: Write minimal implementation**

```csharp
// CreateDesignRevisionCommand.cs
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDesignRevisionCommand(string ProjectId) : ICommand<string>;
```

```csharp
// CreateDesignRevisionCommandHandler.cs
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class CreateDesignRevisionCommandHandler(
    IDesignProjectReadDao projects,
    IDesignRevisionRepository revisions,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<CreateDesignRevisionCommand, string>
{
    public async Task<string> HandleAsync(CreateDesignRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to create a revision.");

        // Project must exist + belong to caller's tenant (404 also hides cross-tenant ids).
        if (!await projects.ExistsAsync(tenant.TenantId, command.ProjectId, ct))
            throw NotFoundException.Entity("DesignProject", command.ProjectId);

        var next = await revisions.GetNextRevisionNumberAsync(tenant.TenantId, command.ProjectId, ct);
        var revision = DesignRevision.Create(command.ProjectId, tenant.TenantId, next);
        await revisions.SaveAsync(revision, ct);
        return revision.Id;
    }
}
```

> Confirm the exact `NotFoundException` factory name against the building block (`NotFoundException.Entity(...)` is the convention used in gis/asset handlers — match whatever exists, e.g. `NotFoundException.Entity("DesignProject", id)`).

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/CreateDesignRevisionCommand.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/CreateDesignRevisionCommandHandler.cs src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/CreateDesignRevisionTests.cs
git commit -m "feat(design): CreateDesignRevision command (DSN-2)"
```

---

## Task 10: Application — Create draft asset (single + batch) commands + handlers

**Files:**
- Create: `…/Application/Commands/DraftAssetInput.cs`
- Create: `…/Application/Commands/CreateDraftAssetCommand.cs`
- Create: `…/Application/Commands/CreateDraftAssetCommandHandler.cs`
- Create: `…/Application/Commands/CreateDraftAssetsBatchCommand.cs`
- Create: `…/Application/Commands/CreateDraftAssetsBatchCommandHandler.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/CreateDraftAssetTests.cs`

Both handlers: load revision (must exist + same tenant → else 404), call `revision.MarkDraftsChanged()` + save revision only if it was Validated, build drafts, persist drafts. Batch persists all in one `AddRangeAsync`.

- [x] **Step 1: Write the failing test**

```csharp
// CreateDraftAssetTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class CreateDraftAssetTests
{
    private sealed class FakeRevisions(DesignRevision? rev) : IDesignRevisionRepository
    {
        public DesignRevision? Saved { get; private set; }
        public Task<int> GetNextRevisionNumberAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(1);
        public Task<DesignRevision> SaveAsync(DesignRevision a, CancellationToken ct = default) { Saved = a; return Task.FromResult(a); }
        public Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default) => Task.FromResult(rev);
        public Task DeleteAsync(string id, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeDrafts : IDraftNetworkAssetRepository
    {
        public List<DraftNetworkAsset> Added { get; } = new();
        public Task AddAsync(DraftNetworkAsset d, CancellationToken ct = default) { Added.Add(d); return Task.CompletedTask; }
        public Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> d, CancellationToken ct = default) { Added.AddRange(d); return Task.CompletedTask; }
        public Task<DraftNetworkAsset?> GetByIdAsync(string t, string id, CancellationToken ct = default) => Task.FromResult<DraftNetworkAsset?>(null);
        public Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(string t, string r, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<DraftNetworkAsset>>(Added);
        public Task UpdateAsync(DraftNetworkAsset d, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FixedTenant(string id = "tenant-1") : ITenantContextAccessor
    {
        public TenantContext? Current => new(id);
    }

    private static DraftAssetInput NodeInput(string code, string? clientRef = null) => new(
        "Node", code, clientRef,
        new DraftGeometryInput("Point", new[] { new[] { 105.8, 21.0 } }),
        new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    [Fact]
    public async Task Single_Create_Adds_Draft()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var drafts = new FakeDrafts();
        var handler = new CreateDraftAssetCommandHandler(new FakeRevisions(rev), drafts, new FixedTenant());

        var id = await handler.HandleAsync(new CreateDraftAssetCommand(rev.Id, NodeInput("N-1")), CancellationToken.None);

        id.Should().NotBeNullOrEmpty();
        drafts.Added.Should().ContainSingle().Which.AssetCode.Should().Be("N-1");
    }

    [Fact]
    public async Task Create_On_Missing_Revision_Throws_NotFound()
    {
        var handler = new CreateDraftAssetCommandHandler(new FakeRevisions(null), new FakeDrafts(), new FixedTenant());
        var act = () => handler.HandleAsync(new CreateDraftAssetCommand("nope", NodeInput("N-1")), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Create_On_Other_Tenant_Revision_Throws_NotFound()
    {
        var rev = DesignRevision.Create("p1", "tenant-OTHER", 1);
        var handler = new CreateDraftAssetCommandHandler(new FakeRevisions(rev), new FakeDrafts(), new FixedTenant("tenant-1"));
        var act = () => handler.HandleAsync(new CreateDraftAssetCommand(rev.Id, NodeInput("N-1")), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Create_On_Validated_Revision_Resets_To_Draft()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty); // → Validated
        var revisions = new FakeRevisions(rev);
        var handler = new CreateDraftAssetCommandHandler(revisions, new FakeDrafts(), new FixedTenant());

        await handler.HandleAsync(new CreateDraftAssetCommand(rev.Id, NodeInput("N-1")), CancellationToken.None);

        revisions.Saved!.Status.Should().Be(DesignRevisionStatus.Draft);
    }

    [Fact]
    public async Task Batch_Create_Adds_All()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var drafts = new FakeDrafts();
        var handler = new CreateDraftAssetsBatchCommandHandler(new FakeRevisions(rev), drafts, new FixedTenant());

        var ids = await handler.HandleAsync(
            new CreateDraftAssetsBatchCommand(rev.Id, new[] { NodeInput("N-1", "c1"), NodeInput("N-2", "c2") }),
            CancellationToken.None);

        ids.Should().HaveCount(2);
        drafts.Added.Should().HaveCount(2);
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — commands/handlers not found.

- [x] **Step 3: Write minimal implementation**

```csharp
// DraftAssetInput.cs
using WaterNetwork.Design.Application.Geometry;

namespace WaterNetwork.Design.Application.Commands;

public sealed record DraftAssetInput(
    string Kind,
    string AssetCode,
    string? ClientRef,
    DraftGeometryInput Geometry,
    IReadOnlyDictionary<string, string> Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);
```

```csharp
// CreateDraftAssetCommand.cs
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDraftAssetCommand(string RevisionId, DraftAssetInput Asset) : ICommand<string>;
```

```csharp
// CreateDraftAssetsBatchCommand.cs
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDraftAssetsBatchCommand(string RevisionId, IReadOnlyList<DraftAssetInput> Assets)
    : ICommand<IReadOnlyList<string>>;
```

Create a small internal helper both handlers reuse (DRY) — put it in the single handler file as a `static` method, or its own file. Use its own file to keep handlers focused:

```csharp
// DraftAssetMapper.cs  (place in …/Application/Commands/)
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.Application.Commands;

internal static class DraftAssetMapper
{
    public static DraftNetworkAsset ToDraft(string revisionId, string tenantId, DraftAssetInput input)
    {
        var kind = input.Kind switch
        {
            "Node" => DraftAssetKind.Node,
            "Pipe" => DraftAssetKind.Pipe,
            "Device" => DraftAssetKind.Device,
            _ => throw new DomainException("DraftAsset.UnknownKind",
                $"Draft kind '{input.Kind}' is not supported (use Node, Pipe or Device).")
        };
        var geometry = DraftGeometryFactory.FromInput(input.Geometry);
        return DraftNetworkAsset.Create(revisionId, tenantId, kind, input.AssetCode, input.ClientRef,
            geometry, input.Attributes, input.FromRef, input.ToRef, input.HostRef);
    }
}
```

```csharp
// CreateDraftAssetCommandHandler.cs
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class CreateDraftAssetCommandHandler(
    IDesignRevisionRepository revisions,
    IDraftNetworkAssetRepository drafts,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<CreateDraftAssetCommand, string>
{
    public async Task<string> HandleAsync(CreateDraftAssetCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        if (revision.Status == DesignRevisionStatus.Validated)
        {
            revision.MarkDraftsChanged();
            await revisions.SaveAsync(revision, ct);
        }

        var draft = DraftAssetMapper.ToDraft(revision.Id, tenant.TenantId, command.Asset);
        await drafts.AddAsync(draft, ct);
        return draft.Id;
    }
}
```

```csharp
// CreateDraftAssetsBatchCommandHandler.cs
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class CreateDraftAssetsBatchCommandHandler(
    IDesignRevisionRepository revisions,
    IDraftNetworkAssetRepository drafts,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<CreateDraftAssetsBatchCommand, IReadOnlyList<string>>
{
    public async Task<IReadOnlyList<string>> HandleAsync(CreateDraftAssetsBatchCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        if (revision.Status == DesignRevisionStatus.Validated)
        {
            revision.MarkDraftsChanged();
            await revisions.SaveAsync(revision, ct);
        }

        var created = command.Assets
            .Select(a => DraftAssetMapper.ToDraft(revision.Id, tenant.TenantId, a))
            .ToList();

        await drafts.AddRangeAsync(created, ct);
        return created.Select(d => d.Id).ToList();
    }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/DraftAssetInput.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/CreateDraftAssetCommand.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/CreateDraftAssetCommandHandler.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/CreateDraftAssetsBatchCommand.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/CreateDraftAssetsBatchCommandHandler.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/DraftAssetMapper.cs src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/CreateDraftAssetTests.cs
git commit -m "feat(design): create draft asset (single + batch) commands (DSN-2)"
```

---

## Task 11: Application — UpdateDraftGeometry + ValidateRevision commands

**Files:**
- Create: `…/Application/Commands/UpdateDraftGeometryCommand.cs`
- Create: `…/Application/Commands/UpdateDraftGeometryCommandHandler.cs`
- Create: `…/Application/Commands/ValidateRevisionCommand.cs`
- Create: `…/Application/Commands/ValidateRevisionCommandHandler.cs`
- Create: `…/Application/Dtos/ValidationResultDto.cs`
- Test: `…/tests/WaterNetwork.Design.UnitTests/ValidateRevisionTests.cs`

`ValidateRevisionCommand` returns a `ValidationResultDto`. Handler: load revision (404), list drafts, run `IDraftValidationService`, `revision.ApplyValidation(result)`, save revision, return DTO.

- [x] **Step 1: Write the failing test**

```csharp
// ValidateRevisionTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class ValidateRevisionTests
{
    private sealed class FakeRevisions(DesignRevision? rev) : IDesignRevisionRepository
    {
        public DesignRevision? Saved { get; private set; }
        public Task<int> GetNextRevisionNumberAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(1);
        public Task<DesignRevision> SaveAsync(DesignRevision a, CancellationToken ct = default) { Saved = a; return Task.FromResult(a); }
        public Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default) => Task.FromResult(rev);
        public Task DeleteAsync(string id, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeDrafts(params DraftNetworkAsset[] items) : IDraftNetworkAssetRepository
    {
        public Task AddAsync(DraftNetworkAsset d, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> d, CancellationToken ct = default) => Task.CompletedTask;
        public Task<DraftNetworkAsset?> GetByIdAsync(string t, string id, CancellationToken ct = default) => Task.FromResult<DraftNetworkAsset?>(null);
        public Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(string t, string r, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<DraftNetworkAsset>>(items);
        public Task UpdateAsync(DraftNetworkAsset d, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeGis(params string[] existing) : IGisLookupPort
    {
        public Task<bool> AssetCodeExists(string t, string code, CancellationToken ct = default) => Task.FromResult(existing.Contains(code));
    }

    private sealed class FixedTenant(string id = "tenant-1") : ITenantContextAccessor
    {
        public TenantContext? Current => new(id);
    }

    private static DraftNetworkAsset Node(string code) => DraftNetworkAsset.Create(
        "rev", "tenant-1", DraftAssetKind.Node, code, null,
        new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) }),
        new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    [Fact]
    public async Task Valid_Revision_Becomes_Validated()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var revisions = new FakeRevisions(rev);
        var handler = new ValidateRevisionCommandHandler(
            revisions, new FakeDrafts(Node("N-1")), new DraftValidationService(), new FakeGis(), new FixedTenant());

        var dto = await handler.HandleAsync(new ValidateRevisionCommand(rev.Id), CancellationToken.None);

        dto.IsValid.Should().BeTrue();
        revisions.Saved!.Status.Should().Be(DesignRevisionStatus.Validated);
    }

    [Fact]
    public async Task Revision_With_Errors_Stays_Draft_And_Reports_Errors()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var revisions = new FakeRevisions(rev);
        var handler = new ValidateRevisionCommandHandler(
            revisions, new FakeDrafts(Node("DUP"), Node("DUP")), new DraftValidationService(), new FakeGis(), new FixedTenant());

        var dto = await handler.HandleAsync(new ValidateRevisionCommand(rev.Id), CancellationToken.None);

        dto.IsValid.Should().BeFalse();
        dto.Errors.Should().Contain(e => e.Code == "DuplicateAssetCode");
        revisions.Saved!.Status.Should().Be(DesignRevisionStatus.Draft);
    }

    [Fact]
    public async Task Missing_Revision_Throws_NotFound()
    {
        var handler = new ValidateRevisionCommandHandler(
            new FakeRevisions(null), new FakeDrafts(), new DraftValidationService(), new FakeGis(), new FixedTenant());
        var act = () => handler.HandleAsync(new ValidateRevisionCommand("nope"), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: FAIL — types not found.

- [x] **Step 3: Write minimal implementation**

```csharp
// ValidationResultDto.cs
namespace WaterNetwork.Design.Application.Dtos;

public sealed record ValidationIssueDto(string Code, string? DraftAssetId, string? ClientRef, string? Field, string Message);

public sealed record ValidationResultDto(
    bool IsValid,
    IReadOnlyList<ValidationIssueDto> Errors,
    IReadOnlyList<ValidationIssueDto> Warnings);
```

```csharp
// UpdateDraftGeometryCommand.cs
using WaterNetwork.Design.Application.Geometry;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record UpdateDraftGeometryCommand(string DraftAssetId, DraftGeometryInput Geometry) : ICommand<Unit>;
```

> Void commands in this codebase use `ICommand<Unit>` + a handler `ICommandHandler<TCommand, Unit>` returning `Unit.Value` (see gis-be `RemoveDeviceCommand`). `Unit` lives in `WaterPlatform.BuildingBlocks.Application.Commands`.

```csharp
// UpdateDraftGeometryCommandHandler.cs
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class UpdateDraftGeometryCommandHandler(
    IDesignRevisionRepository revisions,
    IDraftNetworkAssetRepository drafts,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<UpdateDraftGeometryCommand, Unit>
{
    public async Task<Unit> HandleAsync(UpdateDraftGeometryCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var draft = await drafts.GetByIdAsync(tenant.TenantId, command.DraftAssetId, ct);
        if (draft is null)
            throw NotFoundException.Entity("DraftNetworkAsset", command.DraftAssetId);

        draft.UpdateGeometry(DraftGeometryFactory.FromInput(command.Geometry));
        await drafts.UpdateAsync(draft, ct);

        // A draft change invalidates a previously-Validated revision.
        var revision = await revisions.GetByIdAsync(draft.RevisionId, ct);
        if (revision is { Status: DesignRevisionStatus.Validated })
        {
            revision.MarkDraftsChanged();
            await revisions.SaveAsync(revision, ct);
        }

        return Unit.Value;
    }
}
```

```csharp
// ValidateRevisionCommand.cs
using WaterNetwork.Design.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record ValidateRevisionCommand(string RevisionId) : ICommand<ValidationResultDto>;
```

```csharp
// ValidateRevisionCommandHandler.cs
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class ValidateRevisionCommandHandler(
    IDesignRevisionRepository revisions,
    IDraftNetworkAssetRepository drafts,
    IDraftValidationService validationService,
    IGisLookupPort gisLookup,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<ValidateRevisionCommand, ValidationResultDto>
{
    public async Task<ValidationResultDto> HandleAsync(ValidateRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        var revisionDrafts = await drafts.ListByRevisionAsync(tenant.TenantId, revision.Id, ct);
        var result = await validationService.ValidateAsync(tenant.TenantId, revisionDrafts, gisLookup, ct);

        revision.ApplyValidation(result);
        await revisions.SaveAsync(revision, ct);

        return ToDto(result);
    }

    private static ValidationResultDto ToDto(ValidationResult result) => new(
        IsValid: !result.HasErrors,
        Errors: result.Errors.Select(ToIssueDto).ToList(),
        Warnings: result.Warnings.Select(ToIssueDto).ToList());

    private static ValidationIssueDto ToIssueDto(ValidationIssue i)
        => new(i.Code, i.DraftAssetId, i.ClientRef, i.Field, i.Message);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/UpdateDraftGeometryCommand.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/UpdateDraftGeometryCommandHandler.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/ValidateRevisionCommand.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands/ValidateRevisionCommandHandler.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Dtos/ValidationResultDto.cs src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/ValidateRevisionTests.cs
git commit -m "feat(design): update geometry + validate revision commands (DSN-2)"
```

---

## Task 12: Application — queries + read DAO interface + DTOs

**Files:**
- Create: `…/Application/Dtos/DesignRevisionDetailDto.cs`
- Create: `…/Application/Dtos/DraftAssetPreviewDto.cs`
- Create: `…/Application/Ports/IDesignRevisionReadDao.cs`
- Create: `…/Application/Queries/GetDesignRevisionDetailQuery.cs`
- Create: `…/Application/Queries/GetDesignRevisionDetailQueryHandler.cs`
- Create: `…/Application/Queries/GetRevisionPreviewQuery.cs`
- Create: `…/Application/Queries/GetRevisionPreviewQueryHandler.cs`

No unit test here (thin pass-through handlers; covered by integration tests in Task 16). Build-only verification.

- [x] **Step 1: Write the DTOs, port and queries**

```csharp
// DesignRevisionDetailDto.cs
using WaterNetwork.Design.Application.Dtos;

namespace WaterNetwork.Design.Application.Dtos;

public sealed record DesignRevisionDetailDto(
    string Id,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string Status,
    ValidationResultDto? ValidationResult);
```

```csharp
// DraftAssetPreviewDto.cs
namespace WaterNetwork.Design.Application.Dtos;

public sealed record DraftAssetPreviewDto(
    string Id,
    string Kind,
    string AssetCode,
    string? ClientRef,
    string GeometryType,
    IReadOnlyList<IReadOnlyList<double>> Coordinates,
    string? FromRef,
    string? ToRef,
    string? HostRef,
    IReadOnlyDictionary<string, string> Attributes);
```

```csharp
// IDesignRevisionReadDao.cs
using WaterNetwork.Design.Application.Dtos;

namespace WaterNetwork.Design.Application.Ports;

public interface IDesignRevisionReadDao
{
    Task<DesignRevisionDetailDto?> GetDetailAsync(string tenantId, string revisionId, CancellationToken ct = default);
    Task<bool> ExistsAsync(string tenantId, string revisionId, CancellationToken ct = default);
    Task<IReadOnlyList<DraftAssetPreviewDto>> ListPreviewAsync(string tenantId, string revisionId, CancellationToken ct = default);
}
```

```csharp
// GetDesignRevisionDetailQuery.cs
using WaterNetwork.Design.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Design.Application.Queries;

public sealed record GetDesignRevisionDetailQuery(string RevisionId) : IQuery<DesignRevisionDetailDto?>;
```

```csharp
// GetDesignRevisionDetailQueryHandler.cs
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed class GetDesignRevisionDetailQueryHandler(
    IDesignRevisionReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetDesignRevisionDetailQuery, DesignRevisionDetailDto?>
{
    public async Task<DesignRevisionDetailDto?> HandleAsync(GetDesignRevisionDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return await readDao.GetDetailAsync(tenant.TenantId, query.RevisionId, ct);
    }
}
```

```csharp
// GetRevisionPreviewQuery.cs
using WaterNetwork.Design.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Design.Application.Queries;

public sealed record GetRevisionPreviewQuery(string RevisionId) : IQuery<IReadOnlyList<DraftAssetPreviewDto>?>;
```

```csharp
// GetRevisionPreviewQueryHandler.cs
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed class GetRevisionPreviewQueryHandler(
    IDesignRevisionReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetRevisionPreviewQuery, IReadOnlyList<DraftAssetPreviewDto>?>
{
    public async Task<IReadOnlyList<DraftAssetPreviewDto>?> HandleAsync(GetRevisionPreviewQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        // Return null when the revision does not exist (→ 404 at the endpoint); empty list is a valid preview.
        if (!await readDao.ExistsAsync(tenant.TenantId, query.RevisionId, ct))
            return null;

        return await readDao.ListPreviewAsync(tenant.TenantId, query.RevisionId, ct);
    }
}
```

> Confirm `IQuery<T>` / `IQueryHandler<TQuery,TResult>` names against `GetDesignProjectDetailQuery` + its handler (Task reference list) and match exactly.

- [x] **Step 2: Build to verify it compiles**

Run: `dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj`
Expected: Build succeeded, 0 warnings.

- [x] **Step 3: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Dtos/DesignRevisionDetailDto.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Dtos/DraftAssetPreviewDto.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Ports/IDesignRevisionReadDao.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Queries/GetDesignRevisionDetailQuery.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Queries/GetDesignRevisionDetailQueryHandler.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Queries/GetRevisionPreviewQuery.cs src/services/water-network-design-be/src/WaterNetwork.Design.Application/Queries/GetRevisionPreviewQueryHandler.cs
git commit -m "feat(design): revision detail + preview queries (DSN-2)"
```

---

## Task 13: Contracts — integration event records + mapper

**Files:**
- Modify: `…/WaterNetwork.Design.Contracts/DesignEventTypes.cs`
- Create: `…/WaterNetwork.Design.Contracts/Events/DesignRevisionCreatedV1.cs`
- Create: `…/WaterNetwork.Design.Contracts/Events/DesignRevisionValidatedV1.cs`
- Modify: `…/WaterNetwork.Design.Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs`

- [x] **Step 1: Add event type constants**

In `DesignEventTypes.cs`, add inside the class:

```csharp
    public const string RevisionCreated = "design.revision.created";
    public const string RevisionValidated = "design.revision.validated";
```

- [x] **Step 2: Add the V1 payload records**

```csharp
// DesignRevisionCreatedV1.cs
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.created</c>.</summary>
public sealed record DesignRevisionCreatedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber);
```

```csharp
// DesignRevisionValidatedV1.cs
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.validated</c>.</summary>
public sealed record DesignRevisionValidatedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int ErrorCount,
    int WarningCount,
    bool IsValid);
```

- [x] **Step 3: Extend the mapper**

In `DesignIntegrationEventMapper.cs`, add two integration-event records after the existing ones:

```csharp
public sealed record DesignRevisionCreatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionCreatedV1 Data)
    : IIntegrationEvent<DesignRevisionCreatedV1>;

public sealed record DesignRevisionValidatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionValidatedV1 Data)
    : IIntegrationEvent<DesignRevisionValidatedV1>;
```

Add two registry entries inside the `Registry` dictionary initializer:

```csharp
            ["DesignRevisionCreated"] = e => e is DesignRevisionCreated x ? MapRevisionCreated(x) : null,
            ["DesignRevisionValidated"] = e => e is DesignRevisionValidated x ? MapRevisionValidated(x) : null,
```

Add two mapping methods inside the class:

```csharp
    private static DesignRevisionCreatedIntegrationEvent MapRevisionCreated(DesignRevisionCreated e)
        => new(e.EventId, DesignEventTypes.RevisionCreated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionCreatedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId, e.Data.RevisionNumber));

    private static DesignRevisionValidatedIntegrationEvent MapRevisionValidated(DesignRevisionValidated e)
        => new(e.EventId, DesignEventTypes.RevisionValidated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionValidatedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.ErrorCount, e.Data.WarningCount, e.Data.IsValid));
```

Add the using for the domain events if not already present at the top:
```csharp
using WaterNetwork.Design.Domain.DomainEvents;
```
(It is already imported in the existing file.)

- [x] **Step 4: Build to verify it compiles**

Run:
```bash
dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj
```
Expected: Build succeeded, 0 warnings.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/DesignEventTypes.cs src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/Events/DesignRevisionCreatedV1.cs src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/Events/DesignRevisionValidatedV1.cs src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs
git commit -m "feat(design): revision integration events + mapper (DSN-2)"
```

---

## Task 14: Infrastructure — persistence models, EF config, NTS, migration

**Files:**
- Create: `…/WaterNetwork.Design.Infrastructure/Persistence/DesignRevisionPersistenceModel.cs`
- Create: `…/Persistence/DraftNetworkAssetPersistenceModel.cs`
- Create: `…/Persistence/Configurations/DesignRevisionConfiguration.cs`
- Create: `…/Persistence/Configurations/DraftNetworkAssetConfiguration.cs`
- Create: `…/Persistence/DesignTimeDesignDbContextFactory.cs`
- Add NTS package refs to `…/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj`
- Modify: `…/WaterNetwork.Design.Api/Program.cs` (UseNetTopologySuite)

- [x] **Step 1: Add NTS package references to Infrastructure csproj**

In `…/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj`, inside the `<ItemGroup>` with package references, add:

```xml
    <PackageReference Include="NetTopologySuite" />
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite" />
```

- [x] **Step 2: Write the persistence models**

```csharp
// DesignRevisionPersistenceModel.cs
namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignRevisionPersistenceModel
{
    public string Id { get; set; } = default!;
    public string ProjectId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public int RevisionNumber { get; set; }
    public string Status { get; set; } = default!;
    public string? ValidationResultJson { get; set; }
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

```csharp
// DraftNetworkAssetPersistenceModel.cs
using NetTopologySuite.Geometries;

namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DraftNetworkAssetPersistenceModel
{
    public string Id { get; set; } = default!;
    public string RevisionId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string DraftKind { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string? ClientRef { get; set; }
    public Geometry Geometry { get; set; } = default!;
    public string AttributesJson { get; set; } = "{}";
    public string? FromRef { get; set; }
    public string? ToRef { get; set; }
    public string? HostRef { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

- [x] **Step 3: Write the EF configurations**

```csharp
// DesignRevisionConfiguration.cs
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignRevisionConfiguration : IEntityTypeConfiguration<DesignRevisionPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignRevisionPersistenceModel> builder)
    {
        builder.ToTable("design_revisions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.ProjectId).HasColumnName("project_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.RevisionNumber).HasColumnName("revision_number").IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.ValidationResultJson).HasColumnName("validation_result").HasColumnType("jsonb");
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.ProjectId, x.RevisionNumber })
            .IsUnique().HasDatabaseName("ux_design_revisions_tenant_project_number");
        builder.HasIndex(x => new { x.TenantId, x.ProjectId }).HasDatabaseName("ix_design_revisions_tenant_project");
    }
}
```

```csharp
// DraftNetworkAssetConfiguration.cs
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DraftNetworkAssetConfiguration : IEntityTypeConfiguration<DraftNetworkAssetPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DraftNetworkAssetPersistenceModel> builder)
    {
        builder.ToTable("draft_network_assets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DraftKind).HasColumnName("draft_kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.ClientRef).HasColumnName("client_ref").HasMaxLength(128);
        // Generic geometry column — holds Point (node/device) or LineString (pipe).
        builder.Property(x => x.Geometry).HasColumnName("geometry").HasColumnType("geometry(Geometry,4326)").IsRequired();
        builder.Property(x => x.AttributesJson).HasColumnName("attributes").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.FromRef).HasColumnName("from_ref").HasMaxLength(128);
        builder.Property(x => x.ToRef).HasColumnName("to_ref").HasMaxLength(128);
        builder.Property(x => x.HostRef).HasColumnName("host_ref").HasMaxLength(128);
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.RevisionId }).HasDatabaseName("ix_draft_assets_tenant_revision");
        builder.HasIndex(x => new { x.RevisionId, x.AssetCode }).HasDatabaseName("ix_draft_assets_revision_code");
    }
}
```

- [x] **Step 4: Add the design-time factory (mirrors gis-be) so `dotnet ef` emits NTS + postgis**

```csharp
// DesignTimeDesignDbContextFactory.cs
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignTimeDesignDbContextFactory : IDesignTimeDbContextFactory<DesignDbContext>
{
    public DesignDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<DesignDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_design;Username=postgres;Password=postgres",
                o => o.UseNetTopologySuite())
            .Options;
        return new DesignDbContext(options);
    }
}
```

- [x] **Step 5: Enable NTS in the runtime DI (Program.cs)**

In `…/WaterNetwork.Design.Api/Program.cs`, change the persistence registration line from:

```csharp
builder.Services.AddPlatformPersistence<DesignDbContext>(builder.Configuration);
```
to:
```csharp
builder.Services.AddPlatformPersistence<DesignDbContext>(builder.Configuration, o => o.UseNetTopologySuite());
```

Add the using at the top if not present:
```csharp
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
```
(The `UseNetTopologySuite()` extension lives in the Npgsql NTS package referenced by the Api project transitively via Infrastructure; if the extension is not resolvable in Program.cs, add `<PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite" />` to the Api csproj too — mirror gis-be Api csproj.)

- [x] **Step 6: Generate the migration**

Run:
```bash
dotnet ef migrations add AddDesignRevisionsAndDraftAssets \
  --project src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj \
  --startup-project src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj
```
Expected: a new migration under `…/Infrastructure/Persistence/Migrations/`. **Verify** the generated `Up()` contains:
- `.Annotation("Npgsql:PostgresExtension:postgis", ...)` (EF emits this automatically once a geometry column exists), and
- `create table design_revisions` + `create table draft_network_assets` with the `geometry(Geometry,4326)` column and the two indexes each.

If the postgis extension annotation is missing, the design-time factory's `UseNetTopologySuite()` was not picked up — re-check Step 4/5.

- [x] **Step 7: Build to verify it compiles**

Run:
```bash
dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj
```
Expected: Build succeeded, 0 warnings.

- [x] **Step 8: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Persistence src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj src/services/water-network-design-be/src/WaterNetwork.Design.Api/Program.cs src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj
git commit -m "feat(design): PostGIS+NTS persistence models, config, migration (DSN-2)"
```

---

## Task 15: Infrastructure — repositories, read DAO, GIS lookup stub, DI wiring

**Files:**
- Create: `…/Infrastructure/Repositories/DesignRevisionRepository.cs`
- Create: `…/Infrastructure/Repositories/DraftNetworkAssetRepository.cs`
- Create: `…/Infrastructure/Repositories/DesignRevisionReadDao.cs`
- Create: `…/Infrastructure/GisLookup/GisLookupOptions.cs`
- Create: `…/Infrastructure/GisLookup/StubGisLookupAdapter.cs`
- Modify: `…/WaterNetwork.Design.Api/Program.cs` (DI)
- Modify: `…/WaterNetwork.Design.Api/appsettings.json` (GisLookup section)

All exercised by integration tests in Task 16; build-only here.

- [x] **Step 1: Write the GIS lookup options + stub adapter**

```csharp
// GisLookupOptions.cs
namespace WaterNetwork.Design.Infrastructure.GisLookup;

public sealed class GisLookupOptions
{
    public const string SectionName = "GisLookup";

    public string Provider { get; set; } = "Stub";
    /// <summary>Asset codes the stub treats as already existing in GIS (for tests/demo).</summary>
    public string[] ExistingCodes { get; set; } = Array.Empty<string>();
}
```

```csharp
// StubGisLookupAdapter.cs
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Ports;

namespace WaterNetwork.Design.Infrastructure.GisLookup;

/// <summary>DSN-2 mock for IGisLookupPort. Returns true only for configured ExistingCodes.
/// Replace with an HTTP adapter that calls gis-be in a later slice.</summary>
public sealed class StubGisLookupAdapter(IOptions<GisLookupOptions> options) : IGisLookupPort
{
    private readonly HashSet<string> _existing = new(options.Value.ExistingCodes, StringComparer.Ordinal);

    public Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct = default)
        => Task.FromResult(_existing.Contains(assetCode));
}
```

- [x] **Step 2: Write the revision repository (jsonb validation result round-trip)**

```csharp
// DesignRevisionRepository.cs
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignRevisionRepository(
    DesignDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<DesignRevision>(dbContext, eventDispatcher, outboxRepository), IDesignRevisionRepository
{
    public async Task<int> GetNextRevisionNumberAsync(string tenantId, string projectId, CancellationToken ct = default)
    {
        var max = await dbContext.Set<DesignRevisionPersistenceModel>()
            .Where(x => x.TenantId == tenantId && x.ProjectId == projectId)
            .Select(x => (int?)x.RevisionNumber)
            .MaxAsync(ct);
        return (max ?? 0) + 1;
    }

    public override async Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignRevisionPersistenceModel>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : ToDomain(m);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Design revisions are not deleted in DSN-2.");

    protected override async Task PersistAsync(DesignRevision aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.Set<DesignRevisionPersistenceModel>().FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            if (expectedVersion > 0)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            dbContext.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);
            existing.Status = aggregate.Status.ToString();
            existing.ValidationResultJson = Serialize(aggregate.ValidationResult);
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
        }
    }

    private static DesignRevisionPersistenceModel ToModel(DesignRevision r) => new()
    {
        Id = r.Id, ProjectId = r.ProjectId, TenantId = r.TenantId, RevisionNumber = r.RevisionNumber,
        Status = r.Status.ToString(), ValidationResultJson = Serialize(r.ValidationResult),
        Version = r.Version, CreatedAt = r.CreatedAt, UpdatedAt = r.UpdatedAt
    };

    private static DesignRevision ToDomain(DesignRevisionPersistenceModel m) => DesignRevision.Reconstitute(
        m.Id, m.ProjectId, m.TenantId, m.RevisionNumber,
        Enum.Parse<DesignRevisionStatus>(m.Status), Deserialize(m.ValidationResultJson),
        m.Version, m.CreatedAt, m.UpdatedAt);

    private static string? Serialize(ValidationResult? r) => r is null ? null : JsonSerializer.Serialize(r);
    private static ValidationResult? Deserialize(string? json)
        => string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<ValidationResult>(json);
}
```

- [x] **Step 3: Write the draft repository (geometry + attributes conversion)**

```csharp
// DraftNetworkAssetRepository.cs
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DraftNetworkAssetRepository(DesignDbContext dbContext) : IDraftNetworkAssetRepository
{
    public async Task AddAsync(DraftNetworkAsset draft, CancellationToken ct = default)
    {
        dbContext.Set<DraftNetworkAssetPersistenceModel>().Add(ToModel(draft));
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> drafts, CancellationToken ct = default)
    {
        dbContext.Set<DraftNetworkAssetPersistenceModel>().AddRange(drafts.Select(ToModel));
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task<DraftNetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DraftNetworkAssetPersistenceModel>().AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return m is null ? null : ToDomain(m);
    }

    public async Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(
        string tenantId, string revisionId, CancellationToken ct = default)
    {
        var models = await dbContext.Set<DraftNetworkAssetPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.AssetCode)
            .ToListAsync(ct);
        return models.Select(ToDomain).ToList();
    }

    public async Task UpdateAsync(DraftNetworkAsset draft, CancellationToken ct = default)
    {
        var existing = await dbContext.Set<DraftNetworkAssetPersistenceModel>()
            .FirstOrDefaultAsync(x => x.Id == draft.Id, ct);
        if (existing is null) return;
        existing.Geometry = ToNts(draft.Geometry);
        existing.AttributesJson = JsonSerializer.Serialize(draft.Attributes);
        existing.UpdatedAt = draft.UpdatedAt;
        await dbContext.SaveChangesAsync(ct);
    }

    private static Geometry ToNts(DraftGeometry g) => NtsGeometryConverter.ToNts(g);

    private static DraftNetworkAssetPersistenceModel ToModel(DraftNetworkAsset d) => new()
    {
        Id = d.Id, RevisionId = d.RevisionId, TenantId = d.TenantId, DraftKind = d.Kind.ToString(),
        AssetCode = d.AssetCode, ClientRef = d.ClientRef, Geometry = ToNts(d.Geometry),
        AttributesJson = JsonSerializer.Serialize(d.Attributes),
        FromRef = d.FromRef, ToRef = d.ToRef, HostRef = d.HostRef,
        CreatedAt = d.CreatedAt, UpdatedAt = d.UpdatedAt
    };

    private static DraftNetworkAsset ToDomain(DraftNetworkAssetPersistenceModel m)
    {
        var coords = m.Geometry.Coordinates.Select(c => new GeoCoordinate(c.X, c.Y)).ToList();
        var type = m.Geometry is Point ? DraftGeometryType.Point : DraftGeometryType.LineString;
        var geometry = new DraftGeometry(type, coords);
        var attributes = JsonSerializer.Deserialize<Dictionary<string, string>>(m.AttributesJson)
            ?? new Dictionary<string, string>();
        return DraftNetworkAsset.Reconstitute(
            m.Id, m.RevisionId, m.TenantId, Enum.Parse<DraftAssetKind>(m.DraftKind), m.AssetCode, m.ClientRef,
            geometry, attributes, m.FromRef, m.ToRef, m.HostRef, m.CreatedAt, m.UpdatedAt);
    }
}
```

- [x] **Step 4: Write the read DAO (EF-based to handle geometry)**

```csharp
// DesignRevisionReadDao.cs
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignRevisionReadDao(DesignDbContext dbContext) : IDesignRevisionReadDao
{
    public async Task<DesignRevisionDetailDto?> GetDetailAsync(string tenantId, string revisionId, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignRevisionPersistenceModel>().AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == revisionId && x.TenantId == tenantId, ct);
        if (m is null) return null;

        ValidationResultDto? validation = null;
        if (!string.IsNullOrWhiteSpace(m.ValidationResultJson))
        {
            var raw = JsonSerializer.Deserialize<RawValidationResult>(m.ValidationResultJson);
            if (raw is not null)
                validation = new ValidationResultDto(
                    IsValid: raw.Errors.Count == 0,
                    Errors: raw.Errors.Select(ToDto).ToList(),
                    Warnings: raw.Warnings.Select(ToDto).ToList());
        }

        return new DesignRevisionDetailDto(m.Id, m.ProjectId, m.TenantId, m.RevisionNumber, m.Status, validation);
    }

    public async Task<bool> ExistsAsync(string tenantId, string revisionId, CancellationToken ct = default)
        => await dbContext.Set<DesignRevisionPersistenceModel>()
            .AnyAsync(x => x.Id == revisionId && x.TenantId == tenantId, ct);

    public async Task<IReadOnlyList<DraftAssetPreviewDto>> ListPreviewAsync(
        string tenantId, string revisionId, CancellationToken ct = default)
    {
        var models = await dbContext.Set<DraftNetworkAssetPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.AssetCode)
            .ToListAsync(ct);

        return models.Select(m =>
        {
            var coords = m.Geometry.Coordinates
                .Select(c => (IReadOnlyList<double>)new[] { c.X, c.Y })
                .ToList();
            var type = m.Geometry is Point ? "Point" : "LineString";
            var attrs = JsonSerializer.Deserialize<Dictionary<string, string>>(m.AttributesJson)
                ?? new Dictionary<string, string>();
            return new DraftAssetPreviewDto(m.Id, m.DraftKind, m.AssetCode, m.ClientRef, type, coords,
                m.FromRef, m.ToRef, m.HostRef, attrs);
        }).ToList();
    }

    // Mirror of the Domain ValidationResult JSON shape (PascalCase as serialized by the repository).
    private sealed record RawValidationResult(
        List<RawIssue> Errors,
        List<RawIssue> Warnings);
    private sealed record RawIssue(string Code, string? DraftAssetId, string? ClientRef, string? Field, string Message);

    private static ValidationIssueDto ToDto(RawIssue i)
        => new(i.Code, i.DraftAssetId, i.ClientRef, i.Field, i.Message);
}
```

- [x] **Step 5: Wire DI + config in Program.cs**

In `…/WaterNetwork.Design.Api/Program.cs`, after the existing `AddScoped`/`AddSingleton` registrations, add:

```csharp
builder.Services.AddScoped<WaterNetwork.Design.Domain.Repositories.IDesignRevisionRepository, WaterNetwork.Design.Infrastructure.Repositories.DesignRevisionRepository>();
builder.Services.AddScoped<WaterNetwork.Design.Domain.Repositories.IDraftNetworkAssetRepository, WaterNetwork.Design.Infrastructure.Repositories.DraftNetworkAssetRepository>();
builder.Services.AddScoped<WaterNetwork.Design.Application.Ports.IDesignRevisionReadDao, WaterNetwork.Design.Infrastructure.Repositories.DesignRevisionReadDao>();
builder.Services.AddScoped<WaterNetwork.Design.Application.Services.IDraftValidationService, WaterNetwork.Design.Application.Services.DraftValidationService>();
builder.Services.Configure<WaterNetwork.Design.Infrastructure.GisLookup.GisLookupOptions>(
    builder.Configuration.GetSection(WaterNetwork.Design.Infrastructure.GisLookup.GisLookupOptions.SectionName));
builder.Services.AddSingleton<WaterNetwork.Design.Application.Ports.IGisLookupPort, WaterNetwork.Design.Infrastructure.GisLookup.StubGisLookupAdapter>();
```

> (Use the existing `using` style of the file — the fully-qualified names above are spelled out for clarity; you may add `using` directives instead.)

- [x] **Step 6: Add GisLookup section to appsettings.json**

In `…/WaterNetwork.Design.Api/appsettings.json`, add a top-level section (sibling to `FileStorage`):

```json
  "GisLookup": {
    "Provider": "Stub",
    "ExistingCodes": []
  }
```

- [x] **Step 7: Build to verify it compiles**

Run:
```bash
dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj
```
Expected: Build succeeded, 0 warnings.

- [x] **Step 8: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Repositories src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/GisLookup src/services/water-network-design-be/src/WaterNetwork.Design.Api/Program.cs src/services/water-network-design-be/src/WaterNetwork.Design.Api/appsettings.json
git commit -m "feat(design): revision/draft repositories, read dao, gis stub, DI (DSN-2)"
```

---

## Task 16: Api — request DTOs, validators, endpoint modules

**Files:**
- Create: `…/WaterNetwork.Design.Contracts/Requests/GeometryRequest.cs`
- Create: `…/Contracts/Requests/CreateDraftAssetRequest.cs`
- Create: `…/Contracts/Requests/CreateDraftAssetsBatchRequest.cs`
- Create: `…/Contracts/Requests/UpdateDraftGeometryRequest.cs`
- Create: `…/WaterNetwork.Design.Api/Validators/CreateDraftAssetRequestValidator.cs`
- Create: `…/Api/Validators/CreateDraftAssetsBatchRequestValidator.cs`
- Create: `…/Api/Validators/UpdateDraftGeometryRequestValidator.cs`
- Create: `…/Api/Endpoints/RevisionsEndpointModule.cs`
- Create: `…/Api/Endpoints/DraftAssetsEndpointModule.cs`

- [x] **Step 1: Write the request DTOs**

```csharp
// GeometryRequest.cs
namespace WaterNetwork.Design.Contracts.Requests;

public sealed record GeometryRequest(string Type, IReadOnlyList<IReadOnlyList<double>> Coordinates);
```

```csharp
// CreateDraftAssetRequest.cs
namespace WaterNetwork.Design.Contracts.Requests;

public sealed record CreateDraftAssetRequest(
    string Kind,
    string AssetCode,
    string? ClientRef,
    GeometryRequest Geometry,
    IReadOnlyDictionary<string, string>? Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);
```

```csharp
// CreateDraftAssetsBatchRequest.cs
namespace WaterNetwork.Design.Contracts.Requests;

public sealed record CreateDraftAssetsBatchRequest(IReadOnlyList<CreateDraftAssetRequest> Assets);
```

```csharp
// UpdateDraftGeometryRequest.cs
namespace WaterNetwork.Design.Contracts.Requests;

public sealed record UpdateDraftGeometryRequest(GeometryRequest Geometry);
```

- [x] **Step 2: Write the validators**

```csharp
// CreateDraftAssetRequestValidator.cs
using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class CreateDraftAssetRequestValidator : AbstractValidator<CreateDraftAssetRequest>
{
    private static readonly string[] Kinds = { "Node", "Pipe", "Device" };
    private static readonly string[] GeomTypes = { "Point", "LineString" };

    public CreateDraftAssetRequestValidator()
    {
        RuleFor(x => x.Kind).Must(k => Kinds.Contains(k)).WithMessage("Kind must be Node, Pipe or Device.");
        RuleFor(x => x.AssetCode).NotEmpty();
        RuleFor(x => x.Geometry).NotNull();
        RuleFor(x => x.Geometry.Type).Must(t => GeomTypes.Contains(t))
            .When(x => x.Geometry is not null).WithMessage("Geometry.Type must be Point or LineString.");
        RuleFor(x => x.Geometry.Coordinates).NotEmpty()
            .When(x => x.Geometry is not null);
    }
}
```

```csharp
// CreateDraftAssetsBatchRequestValidator.cs
using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class CreateDraftAssetsBatchRequestValidator : AbstractValidator<CreateDraftAssetsBatchRequest>
{
    public CreateDraftAssetsBatchRequestValidator()
    {
        RuleFor(x => x.Assets).NotEmpty().WithMessage("At least one asset is required.");
        RuleForEach(x => x.Assets).SetValidator(new CreateDraftAssetRequestValidator());
    }
}
```

```csharp
// UpdateDraftGeometryRequestValidator.cs
using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class UpdateDraftGeometryRequestValidator : AbstractValidator<UpdateDraftGeometryRequest>
{
    private static readonly string[] GeomTypes = { "Point", "LineString" };

    public UpdateDraftGeometryRequestValidator()
    {
        RuleFor(x => x.Geometry).NotNull();
        RuleFor(x => x.Geometry.Type).Must(t => GeomTypes.Contains(t))
            .When(x => x.Geometry is not null).WithMessage("Geometry.Type must be Point or LineString.");
        RuleFor(x => x.Geometry.Coordinates).NotEmpty().When(x => x.Geometry is not null);
    }
}
```

- [x] **Step 3: Write the endpoint modules**

```csharp
// RevisionsEndpointModule.cs
using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Queries;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class RevisionsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        // Create revision under a project.
        app.MapPost("/api/design/projects/{projectId}/revisions", async (
                string projectId, ICommandBus bus, CancellationToken ct) =>
            {
                var id = await bus.ExecuteAsync(new CreateDesignRevisionCommand(projectId), ct);
                return Results.Created($"/api/design/revisions/{id}", new { id });
            })
            .RequirePermission("network-design:write");

        var group = app.MapGroup("/api/design/revisions");

        // Validate revision — 200 even when there are business validation errors.
        group.MapPost("/{revisionId}/validate", async (
                string revisionId, ICommandBus bus, CancellationToken ct) =>
            {
                var result = await bus.ExecuteAsync(new ValidateRevisionCommand(revisionId), ct);
                return Results.Ok(result);
            })
            .RequirePermission("network-design:write");

        group.MapGet("/{revisionId}", async Task<Results<Ok<DesignRevisionDetailDto>, NotFound>> (
                string revisionId, IQueryBus bus, CancellationToken ct) =>
            {
                var dto = await bus.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
            })
            .RequirePermission("network-design:read");

        group.MapGet("/{revisionId}/preview", async Task<Results<Ok<IReadOnlyList<DraftAssetPreviewDto>>, NotFound>> (
                string revisionId, IQueryBus bus, CancellationToken ct) =>
            {
                var list = await bus.ExecuteAsync(new GetRevisionPreviewQuery(revisionId), ct);
                return list is null ? TypedResults.NotFound() : TypedResults.Ok(list);
            })
            .RequirePermission("network-design:read");
    }
}
```

```csharp
// DraftAssetsEndpointModule.cs
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class DraftAssetsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var revisionGroup = app.MapGroup("/api/design/revisions/{revisionId}/draft-assets");

        revisionGroup.MapPost("/", async (
                string revisionId, CreateDraftAssetRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var id = await bus.ExecuteAsync(new CreateDraftAssetCommand(revisionId, ToInput(request)), ct);
                return Results.Created($"/api/design/draft-assets/{id}", new { id });
            })
            .WithValidation<CreateDraftAssetRequest>()
            .RequirePermission("network-design:write");

        revisionGroup.MapPost(":batch", async (
                string revisionId, CreateDraftAssetsBatchRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var ids = await bus.ExecuteAsync(
                    new CreateDraftAssetsBatchCommand(revisionId, request.Assets.Select(ToInput).ToList()), ct);
                return Results.Created($"/api/design/revisions/{revisionId}/draft-assets", new { ids });
            })
            .WithValidation<CreateDraftAssetsBatchRequest>()
            .RequirePermission("network-design:write");

        app.MapPatch("/api/design/draft-assets/{id}/geometry", async (
                string id, UpdateDraftGeometryRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new UpdateDraftGeometryCommand(id, ToGeometry(request.Geometry)), ct);
                return Results.NoContent();
            })
            .WithValidation<UpdateDraftGeometryRequest>()
            .RequirePermission("network-design:write");
    }

    private static DraftAssetInput ToInput(CreateDraftAssetRequest r) => new(
        r.Kind, r.AssetCode, r.ClientRef, ToGeometry(r.Geometry),
        r.Attributes ?? new Dictionary<string, string>(), r.FromRef, r.ToRef, r.HostRef);

    private static DraftGeometryInput ToGeometry(GeometryRequest g) => new(g.Type, g.Coordinates);
}
```

> Confirm minimal-API route literals: gis-be uses `MapPost("/")` for collection roots. The `:batch` suffix is a literal segment on the revision group — verify it routes as `/api/design/revisions/{revisionId}/draft-assets:batch`. If colon-suffixed routes are awkward in this stack, fall back to `/batch` (path segment) and update the integration test URL accordingly.

- [x] **Step 4: Build to verify it compiles**

Run:
```bash
dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj
```
Expected: Build succeeded, 0 warnings.

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/Requests src/services/water-network-design-be/src/WaterNetwork.Design.Api/Validators src/services/water-network-design-be/src/WaterNetwork.Design.Api/Endpoints
git commit -m "feat(design): revision + draft-asset endpoints, requests, validators (DSN-2)"
```

---

## Task 17: Integration tests (PostGIS)

**Files:**
- Create: `…/tests/WaterNetwork.Design.IntegrationTests/DesignRevisionApiTests.cs`

Reuse `DesignApiFactory` + `[Collection("design-postgis")]` (already migrate `DesignDbContext`, which now applies the postgis migration). For the "code exists in GIS" test, override config via `factory.ConfigOverrides`.

- [x] **Step 1: Write the integration tests**

```csharp
// DesignRevisionApiTests.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignRevisionApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId = "tenant-1")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId,
            permissions: new[] { "network-design:write", "network-design:read" });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> CreateProject(HttpClient client, string name)
    {
        var resp = await client.PostAsJsonAsync("/api/design/projects", new { name });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }

    private static async Task<string> CreateRevision(HttpClient client, string projectId)
    {
        var resp = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }

    private static object NodeBody(string code, string? clientRef = null) => new
    {
        kind = "Node",
        assetCode = code,
        clientRef,
        geometry = new { type = "Point", coordinates = new[] { new[] { 105.8, 21.0 } } },
        attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
    };

    [Fact]
    public async Task Create_Revision_Increments_Number()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "RevProj-" + Guid.CreateVersion7());

        var r1 = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var r2 = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var id2 = (await r2.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{id2}");
        detail!["revisionNumber"]!.GetValue<int>().Should().Be(2);
        detail["status"]!.GetValue<string>().Should().Be("Draft");
    }

    [Fact]
    public async Task Create_Draft_Single_And_Batch_Then_Preview()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "DraftProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);

        var single = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-1", "c1"));
        single.StatusCode.Should().Be(HttpStatusCode.Created);

        var batch = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets:batch",
            new { assets = new[] { NodeBody("N-2", "c2"), NodeBody("N-3", "c3") } });
        batch.StatusCode.Should().Be(HttpStatusCode.Created);

        var preview = await client.GetFromJsonAsync<JsonArray>($"/api/design/revisions/{revisionId}/preview");
        preview!.Count.Should().Be(3);
    }

    [Fact]
    public async Task Validate_Valid_Revision_Returns_Validated()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "ValidProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-1", "c1"));

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        validate.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await validate.Content.ReadFromJsonAsync<JsonNode>();
        result!["isValid"]!.GetValue<bool>().Should().BeTrue();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{revisionId}");
        detail!["status"]!.GetValue<string>().Should().Be("Validated");
    }

    [Fact]
    public async Task Validate_Duplicate_Code_Returns_Errors_And_Stays_Draft()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "DupProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("DUP", "c1"));
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("DUP", "c2"));

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        var result = await validate.Content.ReadFromJsonAsync<JsonNode>();
        result!["isValid"]!.GetValue<bool>().Should().BeFalse();
        result["errors"]!.AsArray().Should().Contain(e => e!["code"]!.GetValue<string>() == "DuplicateAssetCode");
    }

    [Fact]
    public async Task Validate_Code_Existing_In_Gis_Is_Error()
    {
        using var factory = new DesignApiFactory(postgis);
        factory.ConfigOverrides["GisLookup:ExistingCodes:0"] = "N-EXIST";
        using var client = Client(factory);
        var projectId = await CreateProject(client, "GisProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-EXIST", "c1"));

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        var result = await validate.Content.ReadFromJsonAsync<JsonNode>();
        result!["errors"]!.AsArray().Should().Contain(e => e!["code"]!.GetValue<string>() == "AssetCodeExistsInGis");
    }

    [Fact]
    public async Task Tenant_Isolation_Hides_Other_Tenants_Revision()
    {
        using var factory = new DesignApiFactory(postgis);
        using var a = Client(factory, "tenant-A");
        var projectId = await CreateProject(a, "IsoProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(a, projectId);

        using var b = Client(factory, "tenant-B");
        var get = await b.GetAsync($"/api/design/revisions/{revisionId}");
        get.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

> Note on `GisLookup:ExistingCodes:0` — array elements bind by index in `IConfiguration`. `StubGisLookupAdapter` reads `IOptions<GisLookupOptions>` at construction; since it is registered as a singleton and the factory builds a fresh host per test, the override is picked up. If binding the array proves flaky, instead set `["GisLookup:ExistingCodes:0"] = "N-EXIST"` is correct — keep one element per indexed key.

- [x] **Step 2: Run the integration tests**

Run:
```bash
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj
```
Expected: PASS (all DesignRevisionApiTests green; existing project/document tests still green). Docker must be running for Testcontainers.

- [x] **Step 3: Commit**

```bash
git add src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/DesignRevisionApiTests.cs
git commit -m "test(design): revision + draft + validate integration tests (DSN-2)"
```

---

## Task 18: Contract tests for the two new events

**Files:**
- Create: `…/tests/WaterNetwork.Design.ContractTests/DesignRevisionEventsContractTests.cs`

- [x] **Step 1: Write the contract tests**

```csharp
// DesignRevisionEventsContractTests.cs
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignRevisionEventsContractTests
{
    [Fact]
    public void RevisionCreated_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionCreatedV1("rev-1", "p1", "tenant-1", 2);
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber");
    }

    [Fact]
    public void RevisionValidated_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionValidatedV1("rev-1", "p1", "tenant-1", 0, 1, true);
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "ErrorCount", "WarningCount", "IsValid");
    }

    [Fact]
    public void Event_Types_Are_Fixed()
    {
        DesignEventTypes.RevisionCreated.Should().Be("design.revision.created");
        DesignEventTypes.RevisionValidated.Should().Be("design.revision.validated");
    }
}
```

- [x] **Step 2: Run the contract tests**

Run:
```bash
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj
```
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/DesignRevisionEventsContractTests.cs
git commit -m "test(design): contract tests for revision events (DSN-2)"
```

---

## Task 19: Full suite green + tracking updates

**Files:**
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` (tick DSN-2 in §3.3 and §7.3)
- Modify: `docs/stories/backlog.md` (add "Follow-up sau DSN-2" section)

- [x] **Step 1: Run all three design test projects**

Run:
```bash
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj
```
Expected: All PASS, 0 warnings across builds.

- [x] **Step 2: Tick DSN-2 in the roadmap**

In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §3.3, change the DSN-2 row to mark it done (add a `✓`):

```
| 2 | DSN-2 Draft assets + validate ✓ | design-be | US-P2-03, 04 | DSN-1 |
```

And in §7.3 item 2, append ` ✓ SHIPPED` after "**DSN-2**".

- [x] **Step 3: Add follow-up notes to the backlog**

In `docs/stories/backlog.md`, after the "## Follow-up sau DSN-1" section, add:

```markdown
## Follow-up sau DSN-2 Draft assets + Validate

- **Real `HttpGisLookupAdapter`**: DSN-2 dùng `StubGisLookupAdapter` (config `GisLookup:ExistingCodes`).
  Thay bằng adapter gọi gis-be API khi cần check trùng code thật (swap qua `GisLookup:Provider`).
- **Draft create không atomic với revision reset**: khi revision đang `Validated`, create/update draft
  reset revision→Draft qua 2 SaveChanges (revision repo + draft repo). Window nhỏ, tenant-scoped; chấp
  nhận cho staging. Gộp vào 1 transaction nếu cần chặt hơn.
- **Optional-attribute warnings chưa có rule cụ thể**: engine hỗ trợ `warnings[]` nhưng DSN-2 chưa khai
  báo attr optional nào (chỉ required → error). Thêm khi product chốt danh mục attr.
- **Batch all-or-nothing ở request-level**: 1 phần tử sai schema → 400 toàn batch. Không có partial
  success report (để dành DSN-4 publish imported/failed).
- **Delete/clone draft + diff revision**: chưa làm (US không yêu cầu DSN-2).
- **Unknown deviceType bỏ qua host rule**: engine chỉ enforce host cho Valve/FlowMeter/PressureSensor/
  Pump/Hydrant; deviceType lạ → coi hợp lệ. Siết khi chốt danh mục deviceType.
- **DSN-3**: `SubmitDesignRevision`/`ApproveDesignRevision`/`RejectDesignRevision` + permission
  `network-design:approve` + audit transition.
```

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md docs/stories/backlog.md
git commit -m "docs(design): tick DSN-2 + record follow-ups (DSN-2)"
```

- [ ] **Step 5: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` to decide merge/PR/cleanup.

---

## Self-review notes (for the implementer)

- **Spec coverage:** US-P2-03 (create draft single+batch → Task 10; preview → Task 12/16; status Draft → Task 3). US-P2-04 (duplicate code, missing endpoint, invalid geometry, optional warning, machine-readable result → Task 7/11; "validation success → can submit" enters DSN-3). State machine Draft→Validated → Task 3/11. PostGIS+NTS → Task 6/14. IGisLookupPort + mock → Task 6/15. Events → Task 13. Tenant isolation → Task 16/17.
- **Building-block API names to confirm before relying on them** (grep the building blocks first; they are stable but spelled from memory here): `NotFoundException.Entity(type, id)`, `UnauthorizedException.InvalidToken(...)`, `TenantContext` ctor, `ICommand` (void marker) + `ICommandHandler<TCommand>` (void), `IQuery<T>`/`IQueryHandler<,>`, `ITenantContextAccessor.Current.TenantId`. If any differs, match the existing DSN-1 usage shown in the reference files and adjust uniformly.
- **Geometry coordinate order:** always `[longitude, latitude]` in JSON and `Coordinate(X=lng, Y=lat)` in NTS — matches gis-be exactly.
- **No new packages:** `NetTopologySuite` + `Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite` already exist centrally; only `PackageReference` additions (no versions) are made.
