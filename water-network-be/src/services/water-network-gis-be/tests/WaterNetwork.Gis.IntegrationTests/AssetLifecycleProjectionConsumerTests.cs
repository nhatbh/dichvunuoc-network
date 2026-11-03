using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class AssetLifecycleProjectionConsumerTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static IntegrationEventEnvelope Envelope(string eventId, string eventType, DateTime occurredAt, object data) =>
        new(eventId, eventType, 1, occurredAt, null, null, null, null, null,
            "water-network-asset-be",
            JsonSerializer.Serialize(new
            {
                EventId = eventId, EventType = eventType, EventVersion = 1, OccurredAt = occurredAt,
                SourceAggregateId = "x", SourceAggregateType = "NetworkAsset", Data = data
            }));

    private static async Task<(GisApiFactory f, string nodeId)> BootWithNode(PostgisFixture postgis, string tenantId)
    {
        var f = new GisApiFactory(postgis);
        var client = f.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(new JwtOptions(),
            subject: "u", tenantId: tenantId, authorizedParty: "water-network-gis-fe",
            permissions: ["network-gis:write", "network-gis:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var resp = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = 10.765, longitude = 106.66
        });
        resp.EnsureSuccessStatusCode();
        var nodeId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        return (f, nodeId);
    }

    [Fact]
    public async Task Registered_Then_StatusChanged_Projects_Latest_Status()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await consumer.HandleEnvelopeAsync(Envelope(
            Guid.NewGuid().ToString(), AssetEventTypes.AssetRegistered, t0,
            new AssetRegisteredV1(nodeId, "tenant-proj", "Node", "ND-x", "Active")), default);

        db.ChangeTracker.Clear();
        (await db.NetworkAssetStates.FindAsync(nodeId))!.LifecycleStatus.Should().Be("Active");

        await consumer.HandleEnvelopeAsync(Envelope(
            Guid.NewGuid().ToString(), AssetEventTypes.StatusChanged, t0.AddMinutes(5),
            new AssetStatusChangedV1(nodeId, "Node", "Active", "Suspended", "leak", "op-1")), default);

        db.ChangeTracker.Clear();
        (await db.NetworkAssetStates.FindAsync(nodeId))!.LifecycleStatus.Should().Be("Suspended");
    }

    [Fact]
    public async Task Deliver_Twice_Same_EventId_Applies_Once()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);
        var eventId = Guid.NewGuid().ToString();
        var first = Envelope(eventId, AssetEventTypes.AssetRegistered, t0,
            new AssetRegisteredV1(nodeId, "tenant-proj", "Node", "ND-x", "Active"));

        await consumer.HandleEnvelopeAsync(first, default);

        // Redelivery reuses the SAME eventId but carries a DIFFERENT, newer status. If the inbox did
        // NOT short-circuit, HandleAsync would run and the OccurredAt guard would let "Suspended" win.
        // Asserting the status stayed "Active" proves the handler was SKIPPED, not merely DB-idempotent.
        var redelivery = Envelope(eventId, AssetEventTypes.StatusChanged, t0.AddMinutes(5),
            new AssetStatusChangedV1(nodeId, "Node", "Active", "Suspended", "leak", "op-1"));
        await consumer.HandleEnvelopeAsync(redelivery, default);

        var inbox = scope.ServiceProvider.GetRequiredService<IInboxMessageStore>();
        (await inbox.HasBeenProcessedAsync("gis.asset-lifecycle-projection", eventId)).Should().BeTrue();
        db.ChangeTracker.Clear();
        (await db.NetworkAssetStates.FindAsync(nodeId))!.LifecycleStatus.Should().Be("Active",
            "the redelivery shares the eventId so the inbox must skip the handler entirely");
        (await db.NetworkAssetStates.CountAsync(x => x.AssetId == nodeId)).Should().Be(1);
    }

    [Fact]
    public async Task Out_Of_Order_Older_Status_Does_Not_Regress()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await consumer.HandleEnvelopeAsync(Envelope(Guid.NewGuid().ToString(), AssetEventTypes.StatusChanged,
            t0.AddMinutes(5), new AssetStatusChangedV1(nodeId, "Node", "Active", "Suspended", null, "op")), default);
        await consumer.HandleEnvelopeAsync(Envelope(Guid.NewGuid().ToString(), AssetEventTypes.StatusChanged,
            t0, new AssetStatusChangedV1(nodeId, "Node", "Suspended", "Active", null, "op")), default); // older

        db.ChangeTracker.Clear();
        (await db.NetworkAssetStates.FindAsync(nodeId))!.LifecycleStatus.Should().Be("Suspended");
    }

    [Fact]
    public async Task Ignores_Unsubscribed_Event_Type()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var act = async () => await consumer.HandleEnvelopeAsync(Envelope(
            Guid.NewGuid().ToString(), "asset.technical-profile.updated",
            new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc), new { AssetId = nodeId }), default);

        await act.Should().NotThrowAsync();
        (await db.NetworkAssetStates.CountAsync(x => x.AssetId == nodeId)).Should().Be(0);
    }
}
