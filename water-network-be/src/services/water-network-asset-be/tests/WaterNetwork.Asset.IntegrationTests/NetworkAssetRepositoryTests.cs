using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class NetworkAssetRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task SaveAsync_Then_GetById_RoundTrips_Profile_And_Lifecycle()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
        // IClassFixture shares the PostGIS container; the factory already applied migrations in
        // CreateHost. Migrate() is idempotent, so re-running here is a harmless self-documenting no-op.
        await db.Database.MigrateAsync();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();

        var id = $"node-{Guid.CreateVersion7():N}";
        var asset = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, "ND-001");
        await repo.SaveAsync(asset);

        (await repo.ExistsAsync(id)).Should().BeTrue();
        var reloaded = await repo.GetByIdAsync(id);
        reloaded.Should().NotBeNull();
        reloaded!.Status.Should().Be(AssetStatus.Active);
        reloaded.AssetType.Should().Be(AssetType.Node);
        reloaded.AssetCode.Should().Be("ND-001");
        reloaded.TenantId.Should().Be("tenant-1");
        reloaded.Version.Should().Be(1); // concurrency token must survive the round-trip

        var entry = reloaded.LifecycleEntries.Should().ContainSingle().Subject;
        entry.FromStatus.Should().Be(AssetStatus.Registered); // exercises Enum.ToString -> Enum.Parse round-trip
        entry.ToStatus.Should().Be(AssetStatus.Active);
        entry.ActorId.Should().Be("system");

        var outbox = await db.OutboxEntries.FirstOrDefaultAsync(e => e.AggregateId == id && e.EventType == "AssetRegistered");
        outbox.Should().NotBeNull();
    }
}
