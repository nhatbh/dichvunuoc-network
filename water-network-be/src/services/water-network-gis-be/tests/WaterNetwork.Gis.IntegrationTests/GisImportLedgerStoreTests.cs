using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class GisImportLedgerStoreTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static async Task MigrateAsync(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await db.Database.MigrateAsync();
    }

    [Fact]
    public async Task GetExistingAsync_Initially_Returns_Null()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var store = scope.ServiceProvider.GetRequiredService<IGisImportLedgerStore>();

        var result = await store.GetExistingAsync("rev-1", "d1", CancellationToken.None);

        result.Should().BeNull("no record has been inserted yet");
    }

    [Fact]
    public async Task RecordAsync_Then_GetExistingAsync_Returns_GisAssetId()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var store = scope.ServiceProvider.GetRequiredService<IGisImportLedgerStore>();

        await store.RecordAsync("tenant-1", "rev-1", "d1", "node-x", "Node", "N-1", CancellationToken.None);

        var result = await store.GetExistingAsync("rev-1", "d1", CancellationToken.None);

        result.Should().Be("node-x");
    }

    [Fact]
    public async Task RecordAsync_Duplicate_Is_Idempotent_And_Preserves_Original()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var store = scope.ServiceProvider.GetRequiredService<IGisImportLedgerStore>();

        await store.RecordAsync("tenant-1", "rev-1", "d1", "node-x", "Node", "N-1", CancellationToken.None);

        // Second call with same (revisionId, draftAssetId) — must not throw
        var act = async () =>
            await store.RecordAsync("tenant-1", "rev-1", "d1", "node-x", "Node", "N-1", CancellationToken.None);
        await act.Should().NotThrowAsync("duplicate redelivery must be swallowed as an idempotent no-op");

        // Original gisAssetId must still be returned
        var result = await store.GetExistingAsync("rev-1", "d1", CancellationToken.None);
        result.Should().Be("node-x");
    }
}
