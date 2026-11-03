using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class AssetStatusChangedOutboxTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private sealed class CapturingPublisher : IIntegrationEventPublisher
    {
        public List<IIntegrationEvent> Published { get; } = [];
        public Task PublishAsync(IIntegrationEvent e, string? tenantId = null, CancellationToken ct = default) { Published.Add(e); return Task.CompletedTask; }
    }

    [Fact]
    public async Task Suspend_Publishes_Typed_StatusChanged_Event()
    {
        var publisher = new CapturingPublisher();
        await using var factory = new AssetApiFactory(postgis).WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            foreach (var d in s.Where(x => x.ServiceType == typeof(IIntegrationEventPublisher)).ToList()) s.Remove(d);
            s.AddSingleton<IIntegrationEventPublisher>(publisher);
        }));

        var id = $"node-{Guid.CreateVersion7():N}";
        using (var scope = factory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AssetDbContext>().Database.MigrateAsync();
            var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
            var asset = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[..8]}");
            await repo.SaveAsync(asset);              // asset.registered
            asset.Suspend("user-7", "win");
            await repo.SaveAsync(asset);              // asset.status.changed
        }
        using (var scope = factory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IOutboxProcessor>().ProcessOutboxAsync(CancellationToken.None);

        var statusChanged = publisher.Published.Where(e => e.EventType == AssetEventTypes.StatusChanged).ToList();
        statusChanged.Should().ContainSingle();
        statusChanged[0].GetType().Name.Should().Be("AssetStatusChangedIntegrationEvent");
        statusChanged[0].SourceAggregateId.Should().Be(id);
    }
}
