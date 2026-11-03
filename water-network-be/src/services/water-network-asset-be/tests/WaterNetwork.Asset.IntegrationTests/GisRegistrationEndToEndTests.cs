using System.Globalization;
using System.Text.Json;
using FluentAssertions;
using MassTransit;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

[Collection("real-broker")]
public class GisRegistrationEndToEndTests(PostgisFixture postgis, RabbitMqFixture rabbit)
{
    private AssetApiFactory CreateFactory()
    {
        var f = new AssetApiFactory(postgis);
        f.ConfigOverrides["EventBus:Transport"] = "RabbitMq";
        f.ConfigOverrides["MassTransit:RabbitMq:Host"] = rabbit.Host;
        f.ConfigOverrides["MassTransit:RabbitMq:Port"] = rabbit.Port.ToString(CultureInfo.InvariantCulture);
        f.ConfigOverrides["MassTransit:RabbitMq:Username"] = rabbit.Username;
        f.ConfigOverrides["MassTransit:RabbitMq:Password"] = rabbit.Password;
        return f;
    }

    private static IntegrationEventEnvelope NodeEnvelope(string eventId, string id)
    {
        var concrete = new
        {
            EventId = eventId, EventType = "network.node.registered", EventVersion = 1,
            OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkNode",
            Data = new NetworkNodeRegisteredV1(id, "tenant-e2e", $"ND-{id[..8]}", "Junction", 10.7, 106.6)
        };
        return new IntegrationEventEnvelope(eventId, "network.node.registered", 1, DateTime.UtcNow,
            null, null, null, null, null, "water-network-gis-be",
            JsonSerializer.Serialize(concrete));
    }

    private static async Task<bool> WaitForAssetAsync(AssetApiFactory f, string id, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
            if (await db.NetworkAssets.AnyAsync(x => x.Id == id)) return true;
            await Task.Delay(250);
        }
        return false;
    }

    [Fact]
    public async Task Publishing_NodeRegistered_To_Broker_Creates_Asset_Profile()
    {
        await using var factory = CreateFactory();
        _ = factory.Services; // boot host + bus + migrations
        var bus = factory.Services.GetRequiredService<IBus>();

        var id = $"node-{Guid.NewGuid():N}";
        await bus.Publish(NodeEnvelope($"evt-{Guid.NewGuid():N}", id));

        (await WaitForAssetAsync(factory, id, TimeSpan.FromSeconds(30)))
            .Should().BeTrue("the registered consumer should materialise the profile from the broker message");
    }

    [Fact]
    public async Task Delivering_Same_EventId_Twice_Creates_One_Profile()
    {
        await using var factory = CreateFactory();
        var bus = factory.Services.GetRequiredService<IBus>(); // triggers CreateHost + bus + migrations

        var id = $"node-{Guid.NewGuid():N}";
        var eventId = $"evt-{Guid.NewGuid():N}";
        await bus.Publish(NodeEnvelope(eventId, id));
        await bus.Publish(NodeEnvelope(eventId, id)); // identical EventId

        // Profile exists → first delivery committed.
        (await WaitForAssetAsync(factory, id, TimeSpan.FromSeconds(30))).Should().BeTrue();

        // Wait until the inbox records the EventId processed. Because MarkAsProcessedAsync is the
        // last step of HandleEnvelopeAsync and runs on EVERY delivery (the second short-circuits on
        // the inbox check), an inbox hit proves both deliveries reached the consumer — far stronger
        // than a fixed sleep, which can pass before the second delivery is even dequeued.
        (await WaitForInboxAsync(factory, eventId, TimeSpan.FromSeconds(15)))
            .Should().BeTrue("the consumer should mark the EventId processed after handling the delivery");

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
        (await db.NetworkAssets.CountAsync(x => x.Id == id))
            .Should().Be(1, "an identical EventId must produce exactly one row regardless of delivery count");
    }

    private static async Task<bool> WaitForInboxAsync(AssetApiFactory f, string eventId, TimeSpan timeout)
    {
        const string consumerName = "asset.gis-registration"; // GisAssetRegistrationConsumer.ConsumerName
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            using var scope = f.Services.CreateScope();
            var inbox = scope.ServiceProvider.GetRequiredService<IInboxMessageStore>();
            if (await inbox.HasBeenProcessedAsync(consumerName, eventId)) return true;
            await Task.Delay(250);
        }
        return false;
    }
}
