using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignImportResultStoreTests(PostgisFixture postgis)
{
    [Fact]
    public async Task SaveResultsAsync_PersistsRowsAndListReturnsThemOrdered()
    {
        using var factory = new DesignApiFactory(postgis);
        using var scope = factory.Services.CreateScope();

        // Migrate schema
        scope.ServiceProvider.GetRequiredService<DesignDbContext>().Database.Migrate();

        var store = scope.ServiceProvider.GetRequiredService<IDesignImportResultStore>();

        var rows = new List<ImportResultRow>
        {
            new("d1", "node-x", "imported", null),
            new("d2", null, "failed", "duplicate code")
        };

        await store.SaveResultsAsync("tenant-1", "rev-1", rows, default);

        var result = await store.ListAsync("tenant-1", "rev-1", default);

        result.Should().HaveCount(2);
        result.Should().ContainSingle(r => r.DraftAssetId == "d1" && r.Status == "imported" && r.GisAssetId == "node-x" && r.Reason == null);
        result.Should().ContainSingle(r => r.DraftAssetId == "d2" && r.Status == "failed" && r.Reason == "duplicate code" && r.GisAssetId == null);
    }

    [Fact]
    public async Task SaveResultsAsync_CalledTwiceForSameRevision_ReplacesRows()
    {
        using var factory = new DesignApiFactory(postgis);
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<DesignDbContext>().Database.Migrate();

        var store = scope.ServiceProvider.GetRequiredService<IDesignImportResultStore>();

        var revisionId = "rev-idempotent-" + Guid.CreateVersion7().ToString("N");

        var firstBatch = new List<ImportResultRow>
        {
            new("da1", "gis-1", "imported", null),
            new("da2", "gis-2", "imported", null),
            new("da3", null, "failed", "original reason")
        };

        await store.SaveResultsAsync("tenant-2", revisionId, firstBatch, default);

        // Second save: only 2 rows for the same revision
        var secondBatch = new List<ImportResultRow>
        {
            new("da1", "gis-1-updated", "imported", null),
            new("da2", null, "failed", "now failed")
        };

        await store.SaveResultsAsync("tenant-2", revisionId, secondBatch, default);

        var result = await store.ListAsync("tenant-2", revisionId, default);

        result.Should().HaveCount(2, "second SaveResultsAsync must replace all prior rows");
        result.Should().ContainSingle(r => r.DraftAssetId == "da1" && r.GisAssetId == "gis-1-updated");
        result.Should().ContainSingle(r => r.DraftAssetId == "da2" && r.Status == "failed" && r.Reason == "now failed");
    }
}
