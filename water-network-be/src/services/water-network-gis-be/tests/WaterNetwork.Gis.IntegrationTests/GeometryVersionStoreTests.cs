using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class GeometryVersionStoreTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private const string SampleGeoJson = """{"type":"Point","coordinates":[106.66,10.76]}""";
    private const string GeoJson2 = """{"type":"Point","coordinates":[106.67,10.77]}""";

    private static async Task MigrateAsync(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await db.Database.MigrateAsync();
    }

    // ─── 1. GetNextVersion: no rows → 1; after one row → 2 ───────────────────

    [Fact]
    public async Task GetNextVersion_No_Rows_Returns_1_And_After_Append_Returns_2()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var store = scope.ServiceProvider.GetRequiredService<IGeometryVersionStore>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var assetId = $"node-{Guid.NewGuid():N}"[..20];

        // No rows yet → version 1.
        var v1 = await store.GetNextVersionAsync(assetId);
        v1.Should().Be(1);

        // Append version 1 and save.
        var gv1 = GeometryVersion.Create(assetId, AssetKind.Parse("Node"), 1, SampleGeoJson, "user-1");
        await store.AppendAsync(gv1);
        await dbContext.SaveChangesAsync();

        // Now next version is 2.
        var v2 = await store.GetNextVersionAsync(assetId);
        v2.Should().Be(2);
    }

    // ─── 2. Append v1 + v2, ListByAsset returns both correctly ───────────────

    [Fact]
    public async Task Append_Two_Versions_ListByAsset_Returns_Both_With_Correct_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var store = scope.ServiceProvider.GetRequiredService<IGeometryVersionStore>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var assetId = $"pipe-{Guid.NewGuid():N}"[..20];

        var gv1 = GeometryVersion.Create(assetId, AssetKind.Parse("Pipe"), 1, SampleGeoJson, "user-A", "initial");
        var gv2 = GeometryVersion.Create(assetId, AssetKind.Parse("Pipe"), 2, GeoJson2,     "user-B", "relocation");
        await store.AppendAsync(gv1);
        await store.AppendAsync(gv2);
        await dbContext.SaveChangesAsync();

        var list = await store.ListByAssetAsync(assetId);

        list.Should().HaveCount(2);

        // Returned ordered descending by version; check both items.
        var first = list.First(x => x.Version == 1);
        first.GeoJson.Should().Be(SampleGeoJson);
        first.ChangedBy.Should().Be("user-A");
        first.Reason.Should().Be("initial");
        first.AssetKind.ToString().Should().Be("Pipe");

        var second = list.First(x => x.Version == 2);
        second.GeoJson.Should().Be(GeoJson2);
        second.ChangedBy.Should().Be("user-B");
        second.Reason.Should().Be("relocation");
    }

    // ─── 3. Duplicate (assetId, version) → DbUpdateException on SaveChanges ───
    // The unique constraint fires at the DB write layer; DbUpdateException is the
    // correct assertion here.  ConflictException translation lives at the
    // command-handler layer (via FindPostgresException), not in the save-free store.

    [Fact]
    public async Task Append_Duplicate_Asset_Version_Throws_On_Save()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var store = scope.ServiceProvider.GetRequiredService<IGeometryVersionStore>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var assetId = $"device-{Guid.NewGuid():N}"[..20];

        // Save version 1.
        var gv1 = GeometryVersion.Create(assetId, AssetKind.Parse("Device"), 1, SampleGeoJson);
        await store.AppendAsync(gv1);
        await dbContext.SaveChangesAsync();

        // Attempt to save another version 1 for the same asset (duplicate).
        var gv1Dup = GeometryVersion.Create(assetId, AssetKind.Parse("Device"), 1, GeoJson2);
        await store.AppendAsync(gv1Dup);
        var act = async () => await dbContext.SaveChangesAsync();

        // The unique constraint (asset_id, version) fires at DB write time.
        await act.Should().ThrowAsync<DbUpdateException>();
    }

    // ─── 4. ListByAsset isolates by assetId ──────────────────────────────────

    [Fact]
    public async Task ListByAsset_Returns_Empty_For_Different_Asset()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var store = scope.ServiceProvider.GetRequiredService<IGeometryVersionStore>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var assetIdA = $"node-{Guid.NewGuid():N}"[..20];
        var assetIdB = $"node-{Guid.NewGuid():N}"[..20];

        var gvA = GeometryVersion.Create(assetIdA, AssetKind.Parse("Node"), 1, SampleGeoJson);
        await store.AppendAsync(gvA);
        await dbContext.SaveChangesAsync();

        var listB = await store.ListByAssetAsync(assetIdB);
        listB.Should().BeEmpty("asset B has no geometry versions");
    }
}
