using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class NetworkNodeRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task Save_Then_Get_Roundtrip_And_Outbox_Row_Created()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();

        // IClassFixture shares the PostGIS container; MigrateAsync is a no-op after the first call.
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await dbContext.Database.MigrateAsync();

        var repository = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();

        var node = NetworkNode.Register(
            "tenant-001", new AssetCode($"ND-{Guid.NewGuid():N}"[..16]), NodeType.Junction,
            new GeoPoint(10.762622, 106.660172));

        await repository.SaveAsync(node);

        var loaded = await repository.GetByIdAsync(node.Id);
        loaded.Should().NotBeNull();
        loaded!.AssetCode.Should().Be(node.AssetCode);
        loaded.Location.Latitude.Should().BeApproximately(10.762622, 1e-9);

        dbContext.OutboxEntries.Count(e => e.EventType == "NodeRegistered").Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task SoftDelete_Sets_DeletedAt_And_Emits_NodeDeleted_Outbox_Event()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();

        // IClassFixture shares the PostGIS container; MigrateAsync is a no-op after the first call.
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await dbContext.Database.MigrateAsync();

        var repository = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();

        var node = NetworkNode.Register(
            "tenant-001", new AssetCode($"ND-{Guid.NewGuid():N}"[..16]), NodeType.Junction,
            new GeoPoint(10.762622, 106.660172));

        await repository.SaveAsync(node);

        // Sanity: NodeRegistered was queued by SaveAsync.
        var nodeDeletedBefore = dbContext.OutboxEntries.Count(e => e.EventType == "NodeDeleted");

        await repository.DeleteAsync(node.Id);

        // A new NodeDeleted outbox row was appended for the soft-delete.
        dbContext.OutboxEntries.Count(e => e.EventType == "NodeDeleted")
            .Should().Be(nodeDeletedBefore + 1);

        // Soft-deleted rows are hidden by the global query filter on DeletedAt.
        var loaded = await repository.GetByIdAsync(node.Id);
        loaded.Should().BeNull();
    }
}
