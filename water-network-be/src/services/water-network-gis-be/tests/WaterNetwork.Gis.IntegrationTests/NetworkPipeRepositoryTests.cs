using System.Globalization;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class NetworkPipeRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    // ─── helpers ─────────────────────────────────────────────────────────────

    private static NetworkPipe MakePipe(
        string tenantId = "tenant-001",
        string? assetCode = null,
        string fromNodeId = "node-from-001",
        string toNodeId = "node-to-001",
        double lat1 = 0.0, double lng1 = 0.0,
        double lat2 = 0.0009, double lng2 = 0.0,
        int diameterMm = 150)
    {
        var code = assetCode ?? $"PP-{Guid.NewGuid():N}"[..16];
        return NetworkPipe.Register(
            tenantId,
            new AssetCode(code),
            fromNodeId,
            toNodeId,
            new PipeGeometry(new List<GeoPoint> { new(lat1, lng1), new(lat2, lng2) }),
            new Diameter(diameterMm),
            PipeMaterial.Parse("HDPE"),
            100.0,
            null);
    }

    private static async Task MigrateAsync(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await db.Database.MigrateAsync();
    }

    // ─── tests ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Save_Then_Get_Roundtrip_Preserves_All_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        var pipe = MakePipe(
            tenantId: "tenant-rt",
            fromNodeId: "node-A",
            toNodeId: "node-B",
            lat1: 10.0, lng1: 106.0,
            lat2: 10.0009, lng2: 106.0,
            diameterMm: 200);

        await repository.SaveAsync(pipe);

        var loaded = await repository.GetByIdAsync(pipe.Id);
        loaded.Should().NotBeNull();
        loaded!.TenantId.Should().Be(pipe.TenantId);
        loaded.AssetCode.Should().Be(pipe.AssetCode);
        loaded.FromNodeId.Should().Be(pipe.FromNodeId);
        loaded.ToNodeId.Should().Be(pipe.ToNodeId);
        loaded.DiameterMm.Value.Should().Be(pipe.DiameterMm.Value);
        loaded.Material.ToString().Should().Be(pipe.Material.ToString());
        loaded.LengthM.Should().Be(pipe.LengthM);
        loaded.LengthValidationWarning.Should().Be(pipe.LengthValidationWarning);

        // Geometry round-trip: every point preserved
        loaded.Geometry.Points.Should().HaveCount(pipe.Geometry.Points.Count);
        for (int i = 0; i < pipe.Geometry.Points.Count; i++)
        {
            loaded.Geometry.Points[i].Latitude.Should().BeApproximately(pipe.Geometry.Points[i].Latitude, 1e-9);
            loaded.Geometry.Points[i].Longitude.Should().BeApproximately(pipe.Geometry.Points[i].Longitude, 1e-9);
        }
    }

    [Fact]
    public async Task Duplicate_AssetCode_Same_Tenant_Throws_DbUpdateException_With_UniqueViolation()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        var assetCode = $"PP-{Guid.NewGuid():N}"[..16];

        var pipe1 = MakePipe(tenantId: "tenant-dup", assetCode: assetCode);
        await repository.SaveAsync(pipe1);

        var pipe2 = MakePipe(tenantId: "tenant-dup", assetCode: assetCode);

        // The repository stages; the unique constraint fires at DB write time → DbUpdateException.
        var act = async () => await repository.SaveAsync(pipe2);
        await act.Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task SoftDelete_Update_Path_Increments_Version_And_Sets_DeletedAt()
    {
        // Proves the else-branch of PersistAsync (the update path): save (v0) → reload → SoftDelete
        // → save again → assert Version incremented and DeletedAt persisted.
        // Uses IgnoreQueryFilters() to read the soft-deleted row directly.
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var pipe = MakePipe(tenantId: "tenant-upd-pipe");
        await repository.SaveAsync(pipe);
        var versionAfterInsert = pipe.Version;   // 0 after Register (no MarkAsModified yet)

        // Execute the update path: DeleteAsync calls GetByIdAsync → SoftDelete → SaveAsync.
        await repository.DeleteAsync(pipe.Id);

        // Assert via IgnoreQueryFilters so we can see the soft-deleted row.
        var persisted = await dbContext.NetworkPipes
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.Id == pipe.Id);
        persisted.Should().NotBeNull();
        persisted!.DeletedAt.Should().NotBeNull("SoftDelete must stamp DeletedAt");
        persisted.Version.Should().Be(versionAfterInsert + 1,
            "SoftDelete calls MarkAsModified which increments Version; the update path must persist that bump");
    }

    [Fact]
    public async Task Optimistic_Concurrency_Stale_Version_Throws_ConcurrencyException()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        // Save initial version (stored version = 0, since Register does not call MarkAsModified).
        var pipe = MakePipe(tenantId: "tenant-cc");
        await repository.SaveAsync(pipe);

        // Reconstitute with a HIGHER version (simulates a row that was supposedly already updated
        // by a concurrent writer — the caller holds a snapshot whose version (1) exceeds the DB row's
        // current version (0), which means the DB row is stale relative to the caller's snapshot;
        // the intent-level check fires: stored (0) != expectedVersion (1 - 0 = 1) → ConcurrencyException).
        var stalePipe = NetworkPipe.Reconstitute(
            pipe.Id, pipe.TenantId, pipe.AssetCode,
            pipe.FromNodeId, pipe.ToNodeId,
            pipe.Geometry, pipe.DiameterMm, pipe.Material,
            pipe.LengthM, pipe.LengthValidationWarning,
            version: 1,          // higher than stored (0) — mismatch → ConcurrencyException
            createdAt: pipe.CreatedAt,
            updatedAt: pipe.UpdatedAt,
            deletedAt: null);

        // Saving the mismatched-version aggregate must raise ConcurrencyException.
        var act = async () => await repository.SaveAsync(stalePipe);
        await act.Should().ThrowAsync<ConcurrencyException>();
    }

    [Fact]
    public async Task ExistsByAssetCode_Is_Scoped_Per_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        var pipeA = MakePipe(tenantId: "tenant-A-iso");
        await repository.SaveAsync(pipeA);

        // ExistsByAssetCode must scope by tenantId: tenant-B must not see tenant-A's pipe.
        var existsForB = await repository.ExistsByAssetCodeAsync("tenant-B-iso", pipeA.AssetCode.Value);
        existsForB.Should().BeFalse("a pipe belonging to tenant-A should not appear under tenant-B");

        var existsForA = await repository.ExistsByAssetCodeAsync("tenant-A-iso", pipeA.AssetCode.Value);
        existsForA.Should().BeTrue();
    }

    [Fact]
    public async Task PipeLengthCalculator_Returns_Correct_Meters_Under_CommaSeparatedDecimalCulture()
    {
        // Regression guard: on comma-decimal locales (e.g. de-DE) the WKT builder must still
        // emit "0.0009" not "0,0009" — the latter is invalid WKT and would produce wrong results.
        var originalCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");

            await using var factory = new GisApiFactory(postgis);
            using var scope = factory.Services.CreateScope();
            await MigrateAsync(scope);

            var calculator = scope.ServiceProvider.GetRequiredService<IPipeLengthCalculator>();

            var points = new List<(double Lat, double Lng)>
            {
                (0.0, 0.0),
                (0.0009, 0.0)
            };

            var lengthM = await calculator.CalculateMetersAsync(points);

            lengthM.Should().BeInRange(99.0, 101.0,
                "WKT coordinates must use InvariantCulture so comma-decimal locales do not corrupt the geometry");
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }

    [Fact]
    public async Task PipeLengthCalculator_Returns_Meters_For_LineString_About_100m()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var calculator = scope.ServiceProvider.GetRequiredService<IPipeLengthCalculator>();

        // ~0.0009° latitude ≈ 100 m at the equator (1° lat ≈ 111 km).
        // ST_Length on geometry would return ≈ 0.0009 (degrees), far outside [99, 101].
        // This test pins the geography (metre) semantics requirement.
        var points = new List<(double Lat, double Lng)>
        {
            (0.0, 0.0),
            (0.0009, 0.0)
        };

        var lengthM = await calculator.CalculateMetersAsync(points);

        lengthM.Should().BeInRange(99.0, 101.0,
            "ST_Length on geography(LineString, 4326) must return metres, not degrees");
    }

    // ─── GIS-3 soft-delete / exists tests ─────────────────────────────────────

    [Fact]
    public async Task DeleteAsync_SoftDeletes_Pipe_And_GetByIdAsync_Returns_Null()
    {
        // Proves the soft-delete round-trip: DeleteAsync stamps DeletedAt,
        // and the HasQueryFilter(DeletedAt==null) hides the row from GetByIdAsync.
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        var pipe = MakePipe(tenantId: "tenant-del-pipe");
        await repository.SaveAsync(pipe);

        // Sanity: pipe is findable before deletion.
        var before = await repository.GetByIdAsync(pipe.Id);
        before.Should().NotBeNull();

        await repository.DeleteAsync(pipe.Id);

        // Soft-deleted rows are hidden by the global query filter on DeletedAt.
        var after = await repository.GetByIdAsync(pipe.Id);
        after.Should().BeNull("soft-deleted pipe must not be returned by GetByIdAsync");
    }

    [Fact]
    public async Task ExistsByEndpointNodeAsync_True_For_Live_Pipe_False_After_Deletion()
    {
        // Proves the query filter excludes soft-deleted pipes from ExistsByEndpointNodeAsync —
        // the risk noted in the plan: a removed pipe must NOT block node removal.
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        var nodeId = $"node-{Guid.NewGuid():N}"[..20];
        var pipe = MakePipe(tenantId: "tenant-exists-pipe", fromNodeId: nodeId, toNodeId: "node-other");
        await repository.SaveAsync(pipe);

        // While the pipe is live, the node is an endpoint.
        var existsLive = await repository.ExistsByEndpointNodeAsync(nodeId);
        existsLive.Should().BeTrue("live pipe has nodeId as its FromNodeId");

        // After soft-deleting the pipe, the node is no longer blocked.
        await repository.DeleteAsync(pipe.Id);
        var existsDeleted = await repository.ExistsByEndpointNodeAsync(nodeId);
        existsDeleted.Should().BeFalse("soft-deleted pipe must not count as a live endpoint reference");
    }
}
