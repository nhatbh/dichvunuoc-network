using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Infrastructure.Consumers;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class RevisionPublishFlowTests(PostgisFixture postgis)
{
    private static HttpClient AuthClient(DesignApiFactory factory, string tenantId = "tenant-pub")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(),
            subject: "actor-pub",
            tenantId: tenantId,
            permissions: ["network-design:write", "network-design:read", "network-design:approve"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>Walk Draft→Validated→Submitted→Approved via HTTP and return (revisionId, tenantId, actorId).</summary>
    private static async Task<(string revisionId, string tenantId, string actorId)> SeedApprovedRevision(
        HttpClient client)
    {
        const string tenantId = "tenant-pub";
        const string actorId = "actor-pub";

        var proj = await client.PostAsJsonAsync("/api/design/projects",
            new { name = "PubFlow-" + Guid.CreateVersion7() });
        proj.EnsureSuccessStatusCode();
        var projectId = (await proj.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var rev = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        rev.EnsureSuccessStatusCode();
        var revisionId = (await rev.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var draftBody = new
        {
            kind = "Node",
            assetCode = "ND-PUB-1",
            clientRef = (string?)null,
            geometry = new { type = "Point", coordinates = new[] { new[] { 105.8, 21.0 } } },
            attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
        };
        var draft = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", draftBody);
        draft.EnsureSuccessStatusCode();

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        validate.EnsureSuccessStatusCode();

        var submit = await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.EnsureSuccessStatusCode();

        var approve = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/approve",
            new { reason = "integration test" });
        approve.EnsureSuccessStatusCode();

        return (revisionId, tenantId, actorId);
    }

    private static IntegrationEventEnvelope BuildEnvelope(string eventId, string revisionId, string tenantId, string actorId)
    {
        var payload = JsonSerializer.Serialize(new
        {
            EventId = eventId,
            EventType = DesignEventTypes.RevisionApproved,
            EventVersion = 1,
            OccurredAt = DateTime.UtcNow,
            SourceAggregateId = revisionId,
            SourceAggregateType = "DesignRevision",
            Data = new DesignRevisionApprovedV1(revisionId, "proj-x", tenantId, 1, actorId, "integration test")
        });
        return new IntegrationEventEnvelope(
            eventId, DesignEventTypes.RevisionApproved, 1, DateTime.UtcNow,
            tenantId, null, null, null, null,
            "water-network-design-be",
            payload);
    }

    [Fact]
    public async Task HandleEnvelope_Approved_Revision_Emits_ReadyForGis_Outbox_Entry()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = AuthClient(factory);
        var (revisionId, tenantId, actorId) = await SeedApprovedRevision(client);

        var eventId = Guid.NewGuid().ToString();
        var envelope = BuildEnvelope(eventId, revisionId, tenantId, actorId);

        using var scope = factory.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<RevisionApprovedPublishConsumer>();

        await consumer.HandleEnvelopeAsync(envelope, default);

        var outbox = scope.ServiceProvider.GetRequiredService<IOutboxRepository>();
        var pending = await outbox.GetPendingAsync(100, default);
        pending.Should().Contain(e => e.EventType == nameof(WaterNetwork.Design.Domain.DomainEvents.DesignAssetReadyForGis),
            "BeginPublish must have flushed a DesignAssetReadyForGis domain event to the outbox");
    }

    [Fact]
    public async Task HandleEnvelope_Same_EventId_Twice_Adds_Only_One_Entry()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = AuthClient(factory);
        var (revisionId, tenantId, actorId) = await SeedApprovedRevision(client);

        var eventId = Guid.NewGuid().ToString();
        var envelope = BuildEnvelope(eventId, revisionId, tenantId, actorId);

        using var scope = factory.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<RevisionApprovedPublishConsumer>();
        var outbox = scope.ServiceProvider.GetRequiredService<IOutboxRepository>();

        // First delivery
        await consumer.HandleEnvelopeAsync(envelope, default);
        var afterFirst = (await outbox.GetPendingAsync(100, default))
            .Count(e => e.EventType == nameof(WaterNetwork.Design.Domain.DomainEvents.DesignAssetReadyForGis)
                        && e.AggregateId == revisionId);

        // Second delivery — same eventId, inbox must deduplicate
        await consumer.HandleEnvelopeAsync(envelope, default);
        var afterSecond = (await outbox.GetPendingAsync(100, default))
            .Count(e => e.EventType == nameof(WaterNetwork.Design.Domain.DomainEvents.DesignAssetReadyForGis)
                        && e.AggregateId == revisionId);

        afterFirst.Should().Be(1, "first delivery must produce exactly one outbox entry");
        afterSecond.Should().Be(1, "redelivery of the same eventId must be deduplicated by the inbox");
    }
}
