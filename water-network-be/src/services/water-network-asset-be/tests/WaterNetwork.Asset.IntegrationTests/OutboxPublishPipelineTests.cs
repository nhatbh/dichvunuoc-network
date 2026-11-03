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

public class OutboxPublishPipelineTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private sealed class CapturingPublisher : IIntegrationEventPublisher
    {
        public List<IIntegrationEvent> Published { get; } = [];
        public Task PublishAsync(IIntegrationEvent e, string? tenantId = null, CancellationToken ct = default) { Published.Add(e); return Task.CompletedTask; }
    }

    [Fact]
    public async Task OutboxProcessor_Publishes_Typed_AssetRegistered_Event()
    {
        var publisher = new CapturingPublisher();
        await using var factory = new AssetApiFactory(postgis).WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            foreach (var d in s.Where(x => x.ServiceType == typeof(IIntegrationEventPublisher)).ToList()) s.Remove(d);
            s.AddSingleton<IIntegrationEventPublisher>(publisher);
        }));

        string id = $"node-{Guid.CreateVersion7():N}";
        using (var scope = factory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AssetDbContext>().Database.MigrateAsync();
            var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
            await repo.SaveAsync(NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, "ND-001"));
        }
        using (var scope = factory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IOutboxProcessor>().ProcessOutboxAsync(CancellationToken.None);

        var published = publisher.Published.Where(e => e.SourceAggregateId == id).ToList();
        published.Should().ContainSingle();
        published[0].EventType.Should().Be(AssetEventTypes.AssetRegistered);
        published[0].GetType().Name.Should().Be("AssetRegisteredIntegrationEvent");

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
            var entry = await db.OutboxEntries.FirstAsync(e => e.AggregateId == id && e.EventType == "AssetRegistered");
            entry.Status.Should().Be(OutboxEntryStatus.Processed);
        }
    }
}
