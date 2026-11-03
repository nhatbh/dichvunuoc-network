# GIS-4 GetAssetsInBbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-scoped spatial query `GET /api/network/assets?bbox=&types=&limit=` that returns nodes, pipes and devices inside a bounding box as a GeoJSON FeatureCollection, index-accelerated and guarded against full-table scans.

**Architecture:** Pure read slice — no domain change, no migration, no integration event. A Dapper read DAO runs a `UNION ALL` over `network_nodes`/`network_pipes`/`network_devices` filtered by the PostGIS `&&` bbox operator (uses the existing GiST indexes), fetching `limit+1` rows for truncation detection. A CQRS query handler resolves the tenant and maps rows to a GeoJSON `FeatureCollection`. Request params are bound with `[AsParameters]` and validated by a FluentValidation validator via the existing `WithValidation` endpoint filter.

**Tech Stack:** .NET 10, Dapper, Npgsql, PostGIS (`ST_MakeEnvelope`, `&&`, `ST_AsGeoJSON`), FluentValidation, custom `IQueryBus`/`IQueryHandler` (no MediatR), xUnit + FluentAssertions + NSubstitute, Testcontainers `PostgisFixture`.

---

## Design decisions locked for this slice (confirm at review)

These follow roadmap §4.4/§4.5 and decision 0009. Flag any objection before execution:

1. **Route:** `GET /api/network/assets` (no `/v1/`, per decision 0009 — versioning is the YARP gateway's job). Roadmap's `/api/v1/gis/assets` sketch is read through 0009.
2. **Response shape:** GeoJSON `FeatureCollection` with a foreign member `truncated: bool`. Heterogeneous geometries (Point for node/device, LineString for pipe) live naturally in one FeatureCollection; map clients render it directly.
3. **`bbox` param:** single comma-separated string `minLng,minLat,maxLng,maxLat` (GeoJSON axis order: west,south,east,north). `types` is a comma-separated subset of `node,pipe,device` (default = all three). `limit` optional.
4. **`lifecycleStatus` property:** present in the response but always `null` in GIS-4. The `network_asset_states` projection it comes from does not exist until **GIS-5**, which will add the left join. Shipping the field now (null) keeps the FE/BFF contract additive-stable (§15.1).
5. **Node `status`:** `network_nodes` has no `status` column (verified). The DAO emits `'Active'` for nodes (a non-deleted node is active geometry; business lifecycle is the separate `lifecycleStatus`). Pipes/devices carry their real `status` column.
6. **No new migration, no integration event, no contract test:** GiST indexes `ix_network_nodes_location_gist`, `ix_network_pipes_geometry_gist`, `ix_network_devices_location_gist` already exist; a read query publishes nothing.

---

## File Structure

**Create:**
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Dtos/AssetFeatureCollectionDto.cs` — GeoJSON response records.
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/Bbox.cs` — bbox parse helper (shared by validator + endpoint, DRY).
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQuery.cs` — query record.
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQueryHandler.cs` — handler (tenant + map rows → FeatureCollection).
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IBboxAssetReadDao.cs` — port + `BboxAssetRow` row record.
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Configuration/BboxQueryOptions.cs` — config (area cap, default/max limit).
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/BboxAssetReadDao.cs` — Dapper UNION ALL DAO.
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Contracts/Requests/GetAssetsInBboxRequest.cs` — `[AsParameters]` request.
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Validators/GetAssetsInBboxRequestValidator.cs` — param validator.
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Endpoints/AssetsEndpointModule.cs` — endpoint.
- `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/GetAssetsInBboxRequestValidatorTests.cs`
- `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/GetAssetsInBboxQueryHandlerTests.cs`
- `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/BboxAssetReadDaoTests.cs`
- `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GetAssetsInBboxApiTests.cs`
- `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/BboxQueryIndexUsageTests.cs`

**Modify:**
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs` — register `IBboxAssetReadDao` + bind `BboxQueryOptions`.
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/appsettings.json` — add `GisQuery:Bbox` section.
- `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` — tick GIS-4 in §3.3.
- `docs/stories/backlog.md` — note GIS-4 done.
- `README.md` — fix the long-standing stale Roadmap line (backlog item).

---

## Task 1: GeoJSON DTOs, query, port, options (scaffolding types)

Pure type declarations — no behavior to TDD; verified by build. Subsequent tasks test the behavior that uses them.

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Dtos/AssetFeatureCollectionDto.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQuery.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/Bbox.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IBboxAssetReadDao.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Configuration/BboxQueryOptions.cs`

- [ ] **Step 1: Create the GeoJSON response DTOs**

`AssetFeatureCollectionDto.cs`:

```csharp
using System.Text.Json.Nodes;

namespace WaterNetwork.Gis.Application.Dtos;

/// <summary>
/// GeoJSON-shaped response for the bbox asset query (US-P1-04). Serializes to a
/// standard FeatureCollection so map clients render it directly. <c>Truncated</c>
/// is a GeoJSON foreign member (allowed) signalling the limit was hit.
/// </summary>
public sealed record AssetFeatureCollectionDto(
    IReadOnlyList<AssetFeatureDto> Features,
    bool Truncated)
{
    public string Type => "FeatureCollection";
}

public sealed record AssetFeatureDto(
    string Id,
    JsonNode Geometry,
    AssetFeaturePropertiesDto Properties)
{
    public string Type => "Feature";
}

/// <summary>
/// Flat property bag for one asset feature. Type-specific fields are null for
/// kinds they do not apply to. <c>LifecycleStatus</c> is always null in GIS-4 —
/// GIS-5 populates it from the network_asset_states projection.
/// </summary>
public sealed record AssetFeaturePropertiesDto(
    string Kind,               // Node | Pipe | Device
    string AssetCode,
    string Status,
    string? LifecycleStatus,   // GIS-5: from network_asset_states; null here
    string? NodeType,          // Node only
    int? DiameterMm,           // Pipe only
    string? Material,          // Pipe only
    double? LengthM,           // Pipe only
    string? FromNodeId,        // Pipe only
    string? ToNodeId,          // Pipe only
    string? DeviceType,        // Device only
    string? HostPipeId,        // Device only
    string? HostNodeId);       // Device only
```

- [ ] **Step 2: Create the bbox parse helper**

`Bbox.cs`:

```csharp
using System.Globalization;

namespace WaterNetwork.Gis.Application.Queries;

/// <summary>
/// Parses the "minLng,minLat,maxLng,maxLat" bbox query parameter (GeoJSON axis
/// order: west,south,east,north). Shared by the request validator and the
/// endpoint mapper so parsing rules live in exactly one place.
/// </summary>
public sealed record Bbox(double MinLng, double MinLat, double MaxLng, double MaxLat)
{
    public double AreaSquareDegrees => Math.Abs(MaxLng - MinLng) * Math.Abs(MaxLat - MinLat);

    public static bool TryParse(string? raw, out Bbox? bbox)
    {
        bbox = null;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var parts = raw.Split(',', StringSplitOptions.TrimEntries);
        if (parts.Length != 4) return false;

        var values = new double[4];
        for (var i = 0; i < 4; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i]))
                return false;
        }

        bbox = new Bbox(values[0], values[1], values[2], values[3]);
        return true;
    }
}
```

- [ ] **Step 3: Create the query record**

`GetAssetsInBboxQuery.cs`:

```csharp
using WaterNetwork.Gis.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

/// <summary>
/// Tenant-scoped spatial query. <c>Types</c> is normalized to lowercase tokens
/// (node|pipe|device). <c>Limit</c> is the resolved page size (default applied
/// at the endpoint). The handler fetches Limit+1 rows to detect truncation.
/// </summary>
public sealed record GetAssetsInBboxQuery(
    double MinLng,
    double MinLat,
    double MaxLng,
    double MaxLat,
    IReadOnlyList<string> Types,
    int Limit) : IQuery<AssetFeatureCollectionDto>;
```

- [ ] **Step 4: Create the read DAO port + row record**

`IBboxAssetReadDao.cs`:

```csharp
using WaterNetwork.Gis.Application.Queries;

namespace WaterNetwork.Gis.Application.Ports;

public interface IBboxAssetReadDao
{
    /// <summary>
    /// Returns up to <paramref name="fetchLimit"/> rows of the requested asset
    /// kinds whose geometry overlaps the query bbox, scoped to the tenant.
    /// Caller passes fetchLimit = Limit+1 to detect truncation.
    /// </summary>
    Task<IReadOnlyList<BboxAssetRow>> QueryAsync(
        string tenantId, GetAssetsInBboxQuery query, int fetchLimit, CancellationToken ct = default);
}

/// <summary>Flat Dapper materialization row across the three asset tables.</summary>
public sealed record BboxAssetRow(
    string Kind,        // Node | Pipe | Device
    string Id,
    string AssetCode,
    string Status,
    string GeoJson,     // ST_AsGeoJSON(geometry|location) — raw GeoJSON geometry object
    string? NodeType,
    int? DiameterMm,
    string? Material,
    double? LengthM,
    string? FromNodeId,
    string? ToNodeId,
    string? DeviceType,
    string? HostPipeId,
    string? HostNodeId);
```

- [ ] **Step 5: Create the options record**

`BboxQueryOptions.cs`:

```csharp
namespace WaterNetwork.Gis.Application.Configuration;

/// <summary>
/// Bound from the "GisQuery:Bbox" config section. Caps the queryable bbox area to
/// block full-table scans from a fully zoomed-out client, and the page size.
/// </summary>
public sealed class BboxQueryOptions
{
    public const string SectionName = "GisQuery:Bbox";

    public double MaxAreaSquareDegrees { get; set; } = 1.0;
    public int DefaultLimit { get; set; } = 2000;
    public int MaxLimit { get; set; } = 10000;
}
```

- [ ] **Step 6: Build to verify the types compile**

Run: `dotnet build src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/WaterNetwork.Gis.Application.csproj`
Expected: Build succeeded, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/
git commit -m "feat(gis): add GIS-4 bbox query types (DTOs, query, port, options)"
```

---

## Task 2: Request validator (TDD)

The validator parses bbox, enforces axis ordering, coordinate range, area cap, limit range, and the types whitelist. It reuses `Bbox.TryParse` (DRY) and reads caps from `BboxQueryOptions`.

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Contracts/Requests/GetAssetsInBboxRequest.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Validators/GetAssetsInBboxRequestValidator.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/GetAssetsInBboxRequestValidatorTests.cs`

> Note: the UnitTests project references the Api project (existing request-validator tests live here, e.g. for `RegisterNodeRequestValidator`). Confirm the reference exists; if the existing Api validators are tested elsewhere, place this test in the same project as those.

- [ ] **Step 1: Create the request record**

`GetAssetsInBboxRequest.cs`:

```csharp
namespace WaterNetwork.Gis.Contracts.Requests;

/// <summary>
/// Bound from the query string via [AsParameters].
///   bbox  = "minLng,minLat,maxLng,maxLat"
///   types = "node,pipe,device" (optional; default = all three)
///   limit = int (optional; default from config)
/// </summary>
public sealed record GetAssetsInBboxRequest(string? Bbox, string? Types, int? Limit);
```

- [ ] **Step 2: Write the failing validator tests**

`GetAssetsInBboxRequestValidatorTests.cs`:

```csharp
using FluentValidation.TestHelper;
using Microsoft.Extensions.Options;
using WaterNetwork.Gis.Api.Validators;
using WaterNetwork.Gis.Application.Configuration;
using WaterNetwork.Gis.Contracts.Requests;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class GetAssetsInBboxRequestValidatorTests
{
    private static GetAssetsInBboxRequestValidator CreateValidator() =>
        new(Options.Create(new BboxQueryOptions
        {
            MaxAreaSquareDegrees = 1.0,
            DefaultLimit = 2000,
            MaxLimit = 10000
        }));

    [Fact]
    public void Valid_Request_Passes()
    {
        var result = CreateValidator().TestValidate(
            new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", "node,pipe", 500));
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Missing_Bbox_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest(null, null, null));
        result.ShouldHaveValidationErrorFor(x => x.Bbox);
    }

    [Fact]
    public void Bbox_Not_Four_Numbers_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Inverted_Lng_Fails()
    {
        // minLng >= maxLng
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.7,10.7,106.6,10.8", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Inverted_Lat_Fails()
    {
        // minLat >= maxLat
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.8,106.7,10.7", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Out_Of_Coordinate_Range_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,200.0,10.8", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Bbox_Area_Too_Large_Fails()
    {
        // 2deg x 2deg = 4 deg² > 1.0 cap
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("100.0,10.0,102.0,12.0", null, null));
        result.ShouldHaveValidationErrorFor("Bbox");
    }

    [Fact]
    public void Limit_Zero_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", null, 0));
        result.ShouldHaveValidationErrorFor(x => x.Limit);
    }

    [Fact]
    public void Limit_Above_Max_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", null, 10001));
        result.ShouldHaveValidationErrorFor(x => x.Limit);
    }

    [Fact]
    public void Invalid_Type_Token_Fails()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", "node,zone", null));
        result.ShouldHaveValidationErrorFor(x => x.Types);
    }

    [Fact]
    public void Null_Types_Passes_Means_All()
    {
        var result = CreateValidator().TestValidate(new GetAssetsInBboxRequest("106.6,10.7,106.7,10.8", null, null));
        result.ShouldNotHaveValidationErrorFor(x => x.Types);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/ --filter "FullyQualifiedName~GetAssetsInBboxRequestValidatorTests"`
Expected: FAIL — `GetAssetsInBboxRequestValidator` does not exist.

- [ ] **Step 4: Implement the validator**

`GetAssetsInBboxRequestValidator.cs`:

```csharp
using FluentValidation;
using Microsoft.Extensions.Options;
using WaterNetwork.Gis.Application.Configuration;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Contracts.Requests;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class GetAssetsInBboxRequestValidator : AbstractValidator<GetAssetsInBboxRequest>
{
    private static readonly string[] AllowedTypes = ["node", "pipe", "device"];

    public GetAssetsInBboxRequestValidator(IOptions<BboxQueryOptions> options)
    {
        var opt = options.Value;

        RuleFor(x => x.Bbox)
            .NotEmpty().WithMessage("bbox is required (format: minLng,minLat,maxLng,maxLat).");

        RuleFor(x => x).Custom((req, ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Bbox)) return; // NotEmpty already reported it

            if (!Bbox.TryParse(req.Bbox, out var bbox) || bbox is null)
            {
                ctx.AddFailure("Bbox", "bbox must be four comma-separated numbers: minLng,minLat,maxLng,maxLat.");
                return;
            }

            if (bbox.MinLng < -180 || bbox.MaxLng > 180 || bbox.MinLat < -90 || bbox.MaxLat > 90)
                ctx.AddFailure("Bbox", "bbox coordinates out of range (lng [-180,180], lat [-90,90]).");
            if (bbox.MinLng >= bbox.MaxLng)
                ctx.AddFailure("Bbox", "minLng must be less than maxLng.");
            if (bbox.MinLat >= bbox.MaxLat)
                ctx.AddFailure("Bbox", "minLat must be less than maxLat.");
            if (bbox.AreaSquareDegrees > opt.MaxAreaSquareDegrees)
                ctx.AddFailure("Bbox", $"bbox area too large (max {opt.MaxAreaSquareDegrees} deg²). Zoom in.");
        });

        RuleFor(x => x.Limit)
            .Must(l => l is null or > 0).WithMessage("limit must be greater than 0.")
            .Must(l => l is null || l <= opt.MaxLimit).WithMessage($"limit must not exceed {opt.MaxLimit}.");

        RuleFor(x => x.Types)
            .Must(BeValidTypes).WithMessage("types must be a comma-separated subset of: node, pipe, device.");
    }

    private static bool BeValidTypes(string? types)
    {
        if (string.IsNullOrWhiteSpace(types)) return true; // default = all
        return types
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .All(t => AllowedTypes.Contains(t.ToLowerInvariant()));
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/ --filter "FullyQualifiedName~GetAssetsInBboxRequestValidatorTests"`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Contracts/ \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Validators/ \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/
git commit -m "feat(gis): add GIS-4 bbox request validator with area/limit/type guards"
```

---

## Task 3: Read DAO (integration TDD)

Real PostGIS query against seeded data: tenant isolation, bbox containment, soft-delete exclusion, type filtering, truncation via limit+1.

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/BboxAssetReadDao.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/BboxAssetReadDaoTests.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs`

- [ ] **Step 1: Write the failing integration test**

`BboxAssetReadDaoTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class BboxAssetReadDaoTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    // Small bbox around the seed location (HCMC). All three "inside" assets sit here.
    private const string InsideBbox = "106.65,10.76,106.67,10.77";

    private static HttpClient WriteClient(GisApiFactory factory)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "u", tenantId: "tenant-bbox", permissions: ["network-gis:write"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> SeedNode(HttpClient c, double lat, double lng)
    {
        var resp = await c.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = lat, longitude = lng
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    private static async Task<IReadOnlyList<BboxAssetRow>> RunQuery(
        GisApiFactory factory, string bboxRaw, string[] types, int fetchLimit)
    {
        Bbox.TryParse(bboxRaw, out var bbox);
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        // Set tenant context for the scoped DAO call.
        sp.GetRequiredService<ITenantContextAccessor>().Current = new TenantContext("tenant-bbox");
        var dao = sp.GetRequiredService<IBboxAssetReadDao>();
        var query = new GetAssetsInBboxQuery(bbox!.MinLng, bbox.MinLat, bbox.MaxLng, bbox.MaxLat, types, fetchLimit);
        return await dao.QueryAsync("tenant-bbox", query, fetchLimit, default);
    }

    [Fact]
    public async Task Returns_Only_Assets_Inside_Bbox()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);

        var inside = await SeedNode(client, 10.765, 106.66);
        var outside = await SeedNode(client, 20.0, 120.0); // far away

        var rows = await RunQuery(factory, InsideBbox, ["node"], 100);

        rows.Select(r => r.Id).Should().Contain(inside);
        rows.Select(r => r.Id).Should().NotContain(outside);
    }

    [Fact]
    public async Task Filters_By_Type()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);
        await SeedNode(client, 10.765, 106.66);

        var rows = await RunQuery(factory, InsideBbox, ["pipe"], 100);

        rows.Should().OnlyContain(r => r.Kind == "Pipe");
    }

    [Fact]
    public async Task Truncation_Fetch_Limit_Plus_One()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);
        await SeedNode(client, 10.7651, 106.661);
        await SeedNode(client, 10.7652, 106.662);
        await SeedNode(client, 10.7653, 106.663);

        // fetchLimit = 2+1 = 3; with >=3 nodes in bbox the DAO returns 3 rows → caller infers truncated.
        var rows = await RunQuery(factory, InsideBbox, ["node"], 3);

        rows.Count.Should().Be(3);
    }

    [Fact]
    public async Task Node_Row_Has_GeoJson_And_Active_Status()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);
        var id = await SeedNode(client, 10.765, 106.66);

        var rows = await RunQuery(factory, InsideBbox, ["node"], 100);
        var row = rows.Single(r => r.Id == id);

        row.Kind.Should().Be("Node");
        row.Status.Should().Be("Active");
        row.GeoJson.Should().Contain("\"type\":\"Point\"");
        row.NodeType.Should().Be("Junction");
    }
}
```

> If `TenantContext`'s constructor/shape differs, mirror the construction used in other integration tests that set tenant context. The intent: scope the DAO call to `tenant-bbox`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/ --filter "FullyQualifiedName~BboxAssetReadDaoTests"`
Expected: FAIL — `IBboxAssetReadDao` not registered / `BboxAssetReadDao` missing.

- [ ] **Step 3: Implement the DAO**

`BboxAssetReadDao.cs`:

```csharp
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Dapper bbox read across the three asset tables. Each branch projects into the
/// same flat row shape (NULL-filling type-specific columns), UNION ALL'd, with a
/// single LIMIT @fetchLimit. The PostGIS <c>&amp;&amp;</c> bbox-overlap operator
/// is index-accelerated by the per-table GiST indexes. Geometry is emitted as
/// raw GeoJSON via ST_AsGeoJSON.
/// </summary>
public sealed class BboxAssetReadDao(GisDbContext dbContext) : IBboxAssetReadDao
{
    public async Task<IReadOnlyList<BboxAssetRow>> QueryAsync(
        string tenantId, GetAssetsInBboxQuery query, int fetchLimit, CancellationToken ct = default)
    {
        var selects = new List<string>(3);
        if (query.Types.Contains("node")) selects.Add(NodeSelect);
        if (query.Types.Contains("pipe")) selects.Add(PipeSelect);
        if (query.Types.Contains("device")) selects.Add(DeviceSelect);
        if (selects.Count == 0) return [];

        var sql = string.Join("\nUNION ALL\n", selects) + "\nLIMIT @fetchLimit";

        var parameters = new
        {
            tenantId,
            minLng = query.MinLng,
            minLat = query.MinLat,
            maxLng = query.MaxLng,
            maxLat = query.MaxLat,
            fetchLimit
        };

        var connection = dbContext.Database.GetDbConnection();
        var rows = await connection.QueryAsync<BboxAssetRow>(
            new CommandDefinition(sql, parameters, cancellationToken: ct));
        return rows.AsList();
    }

    private const string NodeSelect = """
        SELECT 'Node'                  AS Kind,
               id                      AS Id,
               asset_code              AS AssetCode,
               'Active'                AS Status,
               ST_AsGeoJSON(location)  AS GeoJson,
               node_type               AS NodeType,
               NULL::int               AS DiameterMm,
               NULL::text              AS Material,
               NULL::double precision  AS LengthM,
               NULL::text              AS FromNodeId,
               NULL::text              AS ToNodeId,
               NULL::text              AS DeviceType,
               NULL::text              AS HostPipeId,
               NULL::text              AS HostNodeId
        FROM network_nodes
        WHERE tenant_id = @tenantId AND deleted_at IS NULL
          AND location && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;

    private const string PipeSelect = """
        SELECT 'Pipe'                  AS Kind,
               id                      AS Id,
               asset_code              AS AssetCode,
               status                  AS Status,
               ST_AsGeoJSON(geometry)  AS GeoJson,
               NULL::text              AS NodeType,
               diameter_mm             AS DiameterMm,
               material                AS Material,
               length_m                AS LengthM,
               from_node_id            AS FromNodeId,
               to_node_id              AS ToNodeId,
               NULL::text              AS DeviceType,
               NULL::text              AS HostPipeId,
               NULL::text              AS HostNodeId
        FROM network_pipes
        WHERE tenant_id = @tenantId AND deleted_at IS NULL
          AND geometry && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;

    private const string DeviceSelect = """
        SELECT 'Device'                AS Kind,
               id                      AS Id,
               asset_code              AS AssetCode,
               status                  AS Status,
               ST_AsGeoJSON(location)  AS GeoJson,
               NULL::text              AS NodeType,
               NULL::int               AS DiameterMm,
               NULL::text              AS Material,
               NULL::double precision  AS LengthM,
               NULL::text              AS FromNodeId,
               NULL::text              AS ToNodeId,
               device_type             AS DeviceType,
               host_pipe_id            AS HostPipeId,
               host_node_id            AS HostNodeId
        FROM network_devices
        WHERE tenant_id = @tenantId AND deleted_at IS NULL
          AND location && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;
}
```

- [ ] **Step 4: Register the DAO in Program.cs**

In `Program.cs`, after the existing `builder.Services.AddScoped<IGeometryVersionReadDao, GeometryVersionReadDao>();` line, add:

```csharp
builder.Services.AddScoped<IBboxAssetReadDao, BboxAssetReadDao>();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/ --filter "FullyQualifiedName~BboxAssetReadDaoTests"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/ \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/BboxAssetReadDaoTests.cs
git commit -m "feat(gis): add GIS-4 bbox read DAO (UNION ALL, && envelope, GeoJSON)"
```

---

## Task 4: Query handler (unit TDD)

Tenant resolution, limit+1 truncation logic, row→Feature mapping.

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQueryHandler.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/GetAssetsInBboxQueryHandlerTests.cs`

- [ ] **Step 1: Write the failing handler tests**

`GetAssetsInBboxQueryHandlerTests.cs`:

```csharp
using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class GetAssetsInBboxQueryHandlerTests
{
    private readonly IBboxAssetReadDao _dao = Substitute.For<IBboxAssetReadDao>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    private static GetAssetsInBboxQuery MakeQuery(int limit) =>
        new(106.6, 10.7, 106.7, 10.8, ["node", "pipe", "device"], limit);

    private static BboxAssetRow NodeRow(string id) =>
        new("Node", id, "ND-1", "Active", "{\"type\":\"Point\",\"coordinates\":[106.66,10.76]}",
            "Junction", null, null, null, null, null, null, null, null);

    private GetAssetsInBboxQueryHandler CreateHandler() => new(_dao, _tenant);

    [Fact]
    public async Task No_Tenant_Throws_Unauthorized()
    {
        _tenant.Current.Returns((TenantContext?)null);
        var act = () => CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);
        await act.Should().ThrowAsync<UnauthorizedException>();
    }

    [Fact]
    public async Task Fetches_Limit_Plus_One()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync("tenant-001", Arg.Any<GetAssetsInBboxQuery>(), 11, Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1")]);

        await CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);

        await _dao.Received(1).QueryAsync("tenant-001", Arg.Any<GetAssetsInBboxQuery>(), 11, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Maps_Row_To_Feature()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<GetAssetsInBboxQuery>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1")]);

        var result = await CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);

        result.Type.Should().Be("FeatureCollection");
        result.Features.Should().HaveCount(1);
        var f = result.Features[0];
        f.Id.Should().Be("n1");
        f.Type.Should().Be("Feature");
        f.Geometry["type"]!.GetValue<string>().Should().Be("Point");
        f.Properties.Kind.Should().Be("Node");
        f.Properties.LifecycleStatus.Should().BeNull();
    }

    [Fact]
    public async Task Not_Truncated_When_Rows_Within_Limit()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<GetAssetsInBboxQuery>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1"), NodeRow("n2")]);

        var result = await CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);

        result.Truncated.Should().BeFalse();
        result.Features.Should().HaveCount(2);
    }

    [Fact]
    public async Task Truncated_When_Rows_Exceed_Limit_And_Extra_Dropped()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        // limit = 2, DAO returns 3 (= limit+1) → truncated, only 2 features returned.
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<GetAssetsInBboxQuery>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1"), NodeRow("n2"), NodeRow("n3")]);

        var result = await CreateHandler().HandleAsync(MakeQuery(2), CancellationToken.None);

        result.Truncated.Should().BeTrue();
        result.Features.Should().HaveCount(2);
    }
}
```

> `TenantContext` construction: match the shape used elsewhere (the existing handlers read `tenantAccessor.Current.TenantId`). If `TenantContext` takes more than `tenantId`, mirror the existing usage in `GetNodeDetailQueryHandlerTests` or equivalent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/ --filter "FullyQualifiedName~GetAssetsInBboxQueryHandlerTests"`
Expected: FAIL — handler does not exist.

- [ ] **Step 3: Implement the handler**

`GetAssetsInBboxQueryHandler.cs`:

```csharp
using System.Text.Json.Nodes;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class GetAssetsInBboxQueryHandler(
    IBboxAssetReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetAssetsInBboxQuery, AssetFeatureCollectionDto>
{
    public async Task<AssetFeatureCollectionDto> HandleAsync(GetAssetsInBboxQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        // Fetch limit+1 so we can flag truncation without a second COUNT round-trip.
        var rows = await readDao.QueryAsync(tenant.TenantId, query, query.Limit + 1, ct);

        var truncated = rows.Count > query.Limit;
        var features = rows.Take(query.Limit).Select(MapFeature).ToList();

        return new AssetFeatureCollectionDto(features, truncated);
    }

    private static AssetFeatureDto MapFeature(BboxAssetRow row) =>
        new(
            Id: row.Id,
            Geometry: JsonNode.Parse(row.GeoJson)!,
            Properties: new AssetFeaturePropertiesDto(
                Kind: row.Kind,
                AssetCode: row.AssetCode,
                Status: row.Status,
                LifecycleStatus: null,           // GIS-5 populates from network_asset_states
                NodeType: row.NodeType,
                DiameterMm: row.DiameterMm,
                Material: row.Material,
                LengthM: row.LengthM,
                FromNodeId: row.FromNodeId,
                ToNodeId: row.ToNodeId,
                DeviceType: row.DeviceType,
                HostPipeId: row.HostPipeId,
                HostNodeId: row.HostNodeId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/ --filter "FullyQualifiedName~GetAssetsInBboxQueryHandlerTests"`
Expected: PASS (5 tests). The handler is auto-registered by the existing `AddHandlersFromAssembly` call — no Program.cs change needed.

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQueryHandler.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/GetAssetsInBboxQueryHandlerTests.cs
git commit -m "feat(gis): add GIS-4 bbox query handler (tenant scope, truncation, GeoJSON map)"
```

---

## Task 5: Endpoint + E2E (integration TDD)

Wire `GET /api/network/assets`, bind params with `[AsParameters]`, run validation filter, require `network-gis:read`, map request → query.

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Endpoints/AssetsEndpointModule.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs` (bind `BboxQueryOptions`)
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/appsettings.json`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GetAssetsInBboxApiTests.cs`

- [ ] **Step 1: Add config section to appsettings.json**

Add this top-level section to `appsettings.json` (e.g. after `"MultiTenancy"`):

```json
  "GisQuery": {
    "Bbox": {
      "MaxAreaSquareDegrees": 1.0,
      "DefaultLimit": 2000,
      "MaxLimit": 10000
    }
  },
```

- [ ] **Step 2: Write the failing E2E tests**

`GetAssetsInBboxApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class GetAssetsInBboxApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private const string InsideBbox = "106.65,10.76,106.67,10.77";

    private static HttpClient Client(GisApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "u", tenantId: "tenant-api", permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task SeedNode(HttpClient c, double lat, double lng)
    {
        var resp = await c.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = lat, longitude = lng
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Returns_FeatureCollection_With_Seeded_Node()
    {
        await using var factory = new GisApiFactory(postgis);
        var writer = Client(factory, "network-gis:write", "network-gis:read");
        await SeedNode(writer, 10.765, 106.66);

        var resp = await writer.GetAsync($"/api/network/assets?bbox={InsideBbox}&types=node");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("type").GetString().Should().Be("FeatureCollection");
        json.GetProperty("features").GetArrayLength().Should().BeGreaterThan(0);
        json.GetProperty("truncated").GetBoolean().Should().BeFalse();

        var feature = json.GetProperty("features")[0];
        feature.GetProperty("type").GetString().Should().Be("Feature");
        feature.GetProperty("geometry").GetProperty("type").GetString().Should().Be("Point");
        feature.GetProperty("properties").GetProperty("kind").GetString().Should().Be("Node");
        feature.GetProperty("properties").GetProperty("lifecycleStatus").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Bbox_Area_Too_Large_Returns_400()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "network-gis:read");
        var resp = await client.GetAsync("/api/network/assets?bbox=100.0,10.0,102.0,12.0");
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Inverted_Bbox_Returns_400()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "network-gis:read");
        var resp = await client.GetAsync("/api/network/assets?bbox=106.7,10.7,106.6,10.8");
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Missing_Permission_Returns_403()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "network-gis:write"); // no read
        var resp = await client.GetAsync($"/api/network/assets?bbox={InsideBbox}");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = factory.CreateClient();
        var resp = await client.GetAsync($"/api/network/assets?bbox={InsideBbox}");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Tenant_Isolation_Other_Tenant_Sees_Nothing()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenantA = Client(factory, "network-gis:write", "network-gis:read"); // tenant-api
        await SeedNode(tenantA, 10.765, 106.66);

        var other = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "u2", tenantId: "tenant-other", permissions: ["network-gis:read"]);
        other.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await other.GetAsync($"/api/network/assets?bbox={InsideBbox}&types=node");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("features").GetArrayLength().Should().Be(0);
    }
}
```

> Confirm the 401/403 expectations match the platform auth setup used by other GIS integration tests (e.g. `RemoveAndRelocateApiTests`). If the test host's Mock JWT yields different status codes for missing token/permission, align these assertions with the existing convention.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/ --filter "FullyQualifiedName~GetAssetsInBboxApiTests"`
Expected: FAIL — endpoint 404 (route not mapped).

- [ ] **Step 4: Bind options in Program.cs**

In `Program.cs`, add (e.g. near the other `builder.Services` config calls, before `var app = builder.Build();`):

```csharp
builder.Services.Configure<WaterNetwork.Gis.Application.Configuration.BboxQueryOptions>(
    builder.Configuration.GetSection(WaterNetwork.Gis.Application.Configuration.BboxQueryOptions.SectionName));
```

- [ ] **Step 5: Implement the endpoint module**

`AssetsEndpointModule.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using WaterNetwork.Gis.Application.Configuration;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Gis.Api.Endpoints;

public sealed class AssetsEndpointModule : IEndpointModule
{
    private static readonly string[] AllTypes = ["node", "pipe", "device"];

    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/network/assets");

        group.MapGet("/", async (
                [AsParameters] GetAssetsInBboxRequest request,
                IQueryBus queryBus,
                IOptions<BboxQueryOptions> options,
                CancellationToken ct) =>
            {
                // The validation filter already guaranteed bbox parses, ordering/area/range
                // are valid, and limit is in range — so parsing here cannot fail.
                Bbox.TryParse(request.Bbox, out var bbox);

                var types = string.IsNullOrWhiteSpace(request.Types)
                    ? AllTypes
                    : request.Types
                        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                        .Select(t => t.ToLowerInvariant())
                        .Distinct()
                        .ToArray();

                var limit = request.Limit ?? options.Value.DefaultLimit;

                var result = await queryBus.ExecuteAsync(
                    new GetAssetsInBboxQuery(bbox!.MinLng, bbox.MinLat, bbox.MaxLng, bbox.MaxLat, types, limit), ct);

                return Results.Ok(result);
            })
            .WithValidation<GetAssetsInBboxRequest>()
            .RequirePermission("network-gis:read");
    }
}
```

> `[AsParameters]` binds the record's properties from the query string. If the project's minimal-API binding rejects a positional record for `[AsParameters]`, convert `GetAssetsInBboxRequest` to a record with init properties or a struct — keep property names `Bbox`, `Types`, `Limit`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/ --filter "FullyQualifiedName~GetAssetsInBboxApiTests"`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/ \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GetAssetsInBboxApiTests.cs
git commit -m "feat(gis): add GIS-4 GET /api/network/assets bbox endpoint (US-P1-04)"
```

---

## Task 6: Index-eligibility verification (integration test)

Roadmap §4.5.4 requires verifying the bbox query is index-accelerated. Small test tables make Postgres prefer a seq scan regardless of indexes, so asserting a "real" plan is flaky. Instead, force `enable_seqscan = off` and assert the planner *can* satisfy the `&&` predicate via each GiST index — this deterministically proves the index exists and is applicable to the query (the property we actually care about).

**Files:**
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/BboxQueryIndexUsageTests.cs`

- [ ] **Step 1: Write the index-usage test**

`BboxQueryIndexUsageTests.cs`:

```csharp
using Dapper;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using WaterNetwork.Gis.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class BboxQueryIndexUsageTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static async Task<string> ExplainAsync(NpgsqlConnection conn, string table, string geomCol)
    {
        // Force the planner away from seq scan so it must use the GiST index if the
        // index is applicable to the && bbox predicate. The plan text then names it.
        await conn.ExecuteAsync("SET enable_seqscan = off;");
        var plan = await conn.QueryAsync<string>(
            $"""
             EXPLAIN
             SELECT id FROM {table}
             WHERE {geomCol} && ST_MakeEnvelope(106.6, 10.7, 106.7, 10.8, 4326)
             """);
        return string.Join("\n", plan);
    }

    [Theory]
    [InlineData("network_nodes", "location", "ix_network_nodes_location_gist")]
    [InlineData("network_pipes", "geometry", "ix_network_pipes_geometry_gist")]
    [InlineData("network_devices", "location", "ix_network_devices_location_gist")]
    public async Task Bbox_Predicate_Uses_Gist_Index(string table, string geomCol, string indexName)
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var conn = (NpgsqlConnection)dbContext.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open)
            await conn.OpenAsync();

        var plan = await ExplainAsync(conn, table, geomCol);

        plan.Should().Contain(indexName,
            $"the && bbox predicate on {table}.{geomCol} must be served by the {indexName} GiST index");
    }
}
```

> If the connection is shared and `SET enable_seqscan = off` would leak to other tests, run it inside a transaction (`SET LOCAL`) or reset it after. Given each test opens its own factory/scope here, a session-level SET on a fresh connection is acceptable; if the fixture pools connections, switch to `SET LOCAL` inside an explicit transaction.

- [ ] **Step 2: Run the test to verify it passes**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/ --filter "FullyQualifiedName~BboxQueryIndexUsageTests"`
Expected: PASS (3 cases). If a case fails because the plan does not name the index, the GiST index is missing or not applicable — stop and investigate before proceeding (this is the test doing its job).

- [ ] **Step 3: Commit**

```bash
git add src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/BboxQueryIndexUsageTests.cs
git commit -m "test(gis): verify GIS-4 bbox predicate is GiST-index eligible on all 3 tables"
```

---

## Task 7: Full verification + docs

**Files:**
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`
- Modify: `docs/stories/backlog.md`
- Modify: `README.md`

- [ ] **Step 1: Run the full GIS test suite**

Run each test project (per CLAUDE.md note: `dotnet test <slnx>` silently runs 0 tests on SDK 10.0.107 — run projects individually):

```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/WaterNetwork.Gis.ContractTests.csproj
```

Expected: all green, 0 warnings (TreatWarningsAsErrors is on).

- [ ] **Step 2: Tick GIS-4 in the roadmap**

In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §3.3, change the GIS-4 row to mark it done (add ✓ as GIS-3 has), and in §4.5 mark item 4 (GIS-4 Bbox query) as shipped.

- [ ] **Step 3: Update the backlog**

In `docs/stories/backlog.md`, update the Phase 1 status line to include GIS-4 done, and add a short "Follow-up sau GIS-4" note capturing residuals: (a) `lifecycleStatus` left join deferred to GIS-5; (b) area cap / limit are config-driven and may need per-tenant tuning later; (c) optional future: cursor-based bulk export endpoint (needed by topology-rs TOP-1, not GIS-4).

- [ ] **Step 4: Fix the stale README roadmap line**

In `README.md`, fix the Roadmap section that still reads "Phase 2: asset/customer/master-data" to match the SPEC (Phase 1 = GIS + Asset + BFF). This closes the long-standing note tracked in backlog.md line 24 and roadmap §1.2.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md
git commit -m "docs(gis): tick GIS-4 done; record GIS-4 follow-ups; fix README roadmap"
```

---

## Self-Review (completed by plan author)

**Spec coverage (roadmap §4.4 / §4.5.4 / US-P1-04):**
- Dapper via DB connection, UNION 3 types, `&&` + `ST_MakeEnvelope` → Task 3 DAO. ✓
- Validation minLng<maxLng, minLat<maxLat, area cap → 400 → Task 2 validator + Task 5 E2E. ✓
- limit default 2000 / max 10000 / `truncated: true` → Task 1 options, Task 4 truncation, Task 5 E2E. ✓
- Left join `network_asset_states` for `lifecycleStatus` → **deferred to GIS-5** (table doesn't exist yet); field shipped as null. Documented decision #4. ✓
- GeoJSON FeatureCollection response → Task 1 DTOs + Task 4 mapping. ✓
- Index verification via EXPLAIN → Task 6 (forced-seqscan-off variant for determinism). ✓
- Tenant isolation test → Task 5 E2E + Task 3 DAO scoping. ✓

**Placeholder scan:** No TBD/"add validation"/"handle edge cases" — every step carries full code or an exact command. ✓

**Type consistency:** `GetAssetsInBboxRequest(Bbox,Types,Limit)`, `GetAssetsInBboxQuery(MinLng,MinLat,MaxLng,MaxLat,Types,Limit)`, `BboxAssetRow` columns ↔ SQL `AS` aliases ↔ `AssetFeaturePropertiesDto` fields all align. `IBboxAssetReadDao.QueryAsync(tenantId, query, fetchLimit, ct)` signature matches handler call and test mocks. `Bbox.TryParse` used by validator, DAO-test helper, and endpoint. ✓

**Open items to confirm during execution (not blockers):**
- Exact `TenantContext` constructor shape (used in handler unit test + DAO integration test).
- `[AsParameters]` binding of a positional record (fallback: init-property record/struct).
- Platform 401/403 status conventions under Mock JWT (align E2E assertions with existing GIS integration tests).
