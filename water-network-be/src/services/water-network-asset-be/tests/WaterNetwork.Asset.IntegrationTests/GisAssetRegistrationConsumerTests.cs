using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Consumers;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class GisAssetRegistrationConsumerTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static IntegrationEventEnvelope EnvelopeFor(string eventId, string eventType, object concreteEvent) =>
        new(eventId, eventType, 1, DateTime.UtcNow, null, null, null, null, null,
            "water-network-gis-be", JsonSerializer.Serialize(concreteEvent));

    private static object NodeRegisteredConcrete(string id, string assetCode = "ND-001") => new
    {
        EventId = Guid.NewGuid().ToString(), EventType = "network.node.registered", EventVersion = 1,
        OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkNode",
        Data = new NetworkNodeRegisteredV1(id, "tenant-1", assetCode, "Junction", 10.7, 106.6)
    };

    private static object NodeRegisteredConcreteWith(string id, string tenantId, string assetCode) => new
    {
        EventId = Guid.NewGuid().ToString(), EventType = "network.node.registered", EventVersion = 1,
        OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkNode",
        Data = new NetworkNodeRegisteredV1(id, tenantId, assetCode, "Junction", 10.7, 106.6)
    };

    private static async Task<(AssetApiFactory f, IServiceScope s)> BootAsync(PostgisFixture postgis)
    {
        var f = new AssetApiFactory(postgis);
        var s = f.Services.CreateScope();
        await s.ServiceProvider.GetRequiredService<AssetDbContext>().Database.MigrateAsync();
        return (f, s);
    }

    [Theory]
    [InlineData("network.node.registered", AssetType.Node)]
    [InlineData("network.pipe.registered", AssetType.Pipe)]
    [InlineData("network.device.installed", AssetType.Device)]
    public async Task Creates_Profile_For_Each_Registration_Event(string eventType, AssetType expected)
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;
        var id = $"asset-{Guid.NewGuid():N}";
        // Use unique asset codes per test invocation to avoid (tenant_id, asset_code) unique-constraint
        // collisions on the shared PostGIS container within the class fixture lifetime.
        var uniqueSuffix = id[^8..];
        object concrete = eventType switch
        {
            "network.node.registered" => NodeRegisteredConcrete(id, $"ND-{uniqueSuffix}"),
            "network.pipe.registered" => new { EventId = Guid.NewGuid().ToString(), EventType = eventType, EventVersion = 1,
                OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkPipe",
                Data = new NetworkPipeRegisteredV1(id, "tenant-1", $"PP-{uniqueSuffix}", "n1", "n2", 12.5, 150, "PVC") },
            _ => new { EventId = Guid.NewGuid().ToString(), EventType = eventType, EventVersion = 1,
                OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkDevice",
                Data = new NetworkDeviceInstalledV1(id, "tenant-1", $"DV-{uniqueSuffix}", "Valve", null, "n1", 10.7, 106.6) }
        };

        var consumer = scope.ServiceProvider.GetRequiredService<GisAssetRegistrationConsumer>();
        await consumer.HandleEnvelopeAsync(EnvelopeFor(Guid.NewGuid().ToString(), eventType, concrete), default);

        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var asset = await repo.GetByIdAsync(id);
        asset.Should().NotBeNull();
        asset!.AssetType.Should().Be(expected);
        asset.Status.Should().Be(AssetStatus.Active);
    }

    [Fact]
    public async Task Ignores_Unsubscribed_Event_Type()
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;
        var consumer = scope.ServiceProvider.GetRequiredService<GisAssetRegistrationConsumer>();
        var env = EnvelopeFor(Guid.NewGuid().ToString(), "network.node.deleted",
            new { EventId = Guid.NewGuid().ToString(), Data = new { NodeId = "x" } });

        var act = async () => await consumer.HandleEnvelopeAsync(env, default);
        await act.Should().NotThrowAsync();
        (await scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>().ExistsAsync("x")).Should().BeFalse();
    }

    [Fact]
    public async Task Deliver_Twice_Same_EventId_Creates_One_Profile()
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;
        var id = $"node-{Guid.NewGuid():N}";
        // Use a unique eventId per test invocation to avoid cross-run inbox state from the shared container.
        var eventId = $"evt-{Guid.NewGuid():N}";
        // Use a unique asset code to avoid (tenant_id, asset_code) unique-constraint collisions
        // on the shared PostGIS container within the class fixture lifetime.
        var env = EnvelopeFor(eventId, "network.node.registered", NodeRegisteredConcrete(id, $"ND-{id[^8..]}"));
        var consumer = scope.ServiceProvider.GetRequiredService<GisAssetRegistrationConsumer>();

        await consumer.HandleEnvelopeAsync(env, default);
        await consumer.HandleEnvelopeAsync(env, default); // redelivery

        var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
        (await db.NetworkAssets.CountAsync(x => x.Id == id)).Should().Be(1);
    }

    [Fact]
    public async Task Different_Asset_Colliding_On_AssetCode_Throws_And_Is_Not_Marked_Processed()
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;

        // Use a unique assetCode per invocation — the collision is the point WITHIN this test,
        // but we don't want cross-run contamination from the shared container.
        var uniqueCode = $"DUP-{Guid.NewGuid():N}"[..16];
        var tenant = "tenant-1";
        var idA = $"node-A-{Guid.NewGuid():N}";
        var idB = $"node-B-{Guid.NewGuid():N}";
        var evtIdA = Guid.NewGuid().ToString();
        var evtIdB = Guid.NewGuid().ToString();

        var consumer = scope.ServiceProvider.GetRequiredService<GisAssetRegistrationConsumer>();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var inbox = scope.ServiceProvider.GetRequiredService<IInboxMessageStore>();

        // Register asset A first — establishes (tenant, assetCode) = (tenant-1, uniqueCode).
        var envA = EnvelopeFor(evtIdA, "network.node.registered", NodeRegisteredConcreteWith(idA, tenant, uniqueCode));
        await consumer.HandleEnvelopeAsync(envA, default);
        (await repo.ExistsAsync(idA)).Should().BeTrue("asset A must be persisted before we test the collision");

        // Asset B has a DIFFERENT id but the SAME (tenant, assetCode) — this is the data-loss path under test.
        var envB = EnvelopeFor(evtIdB, "network.node.registered", NodeRegisteredConcreteWith(idB, tenant, uniqueCode));

        // The consumer must rethrow rather than silently swallow the unique violation.
        var act = async () => await consumer.HandleEnvelopeAsync(envB, default);
        await act.Should().ThrowAsync<Exception>("a (tenant_id, asset_code) collision for a *different* assetId is not idempotent and must surface");

        // Asset B must NOT have been persisted.
        (await repo.ExistsAsync(idB)).Should().BeFalse("the conflicting asset must not be silently dropped");

        // The inbox must NOT have marked envB's EventId processed — a redelivery must retry, not skip.
        (await inbox.HasBeenProcessedAsync("asset.gis-registration", evtIdB)).Should().BeFalse(
            "a failed message must not be marked processed; a redelivery must be able to retry");
    }
}
