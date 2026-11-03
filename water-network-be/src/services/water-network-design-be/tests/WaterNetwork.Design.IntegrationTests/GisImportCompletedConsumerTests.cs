using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Consumers;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class GisImportCompletedConsumerTests(PostgisFixture postgis)
{
    private static HttpClient AuthClient(DesignApiFactory factory, string tenantId = "tenant-gis-import")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(),
            subject: "actor-gis",
            tenantId: tenantId,
            permissions: ["network-design:write", "network-design:read", "network-design:approve"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>Walk Draft→Validated→Submitted→Approved via HTTP and return (revisionId, tenantId, draftAssetId).</summary>
    private static async Task<(string revisionId, string tenantId, string draftAssetId)> SeedApprovedRevision(
        HttpClient client, string tenantId = "tenant-gis-import")
    {
        var proj = await client.PostAsJsonAsync("/api/design/projects",
            new { name = "GisImport-" + Guid.CreateVersion7() });
        proj.EnsureSuccessStatusCode();
        var projectId = (await proj.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var rev = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        rev.EnsureSuccessStatusCode();
        var revisionId = (await rev.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var draftBody = new
        {
            kind = "Node",
            assetCode = "ND-GIS-1",
            clientRef = (string?)null,
            geometry = new { type = "Point", coordinates = new[] { new[] { 105.8, 21.0 } } },
            attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
        };
        var draft = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", draftBody);
        draft.EnsureSuccessStatusCode();
        var draftAssetId = (await draft.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        validate.EnsureSuccessStatusCode();

        var submit = await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.EnsureSuccessStatusCode();

        var approve = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/approve",
            new { reason = "integration test" });
        approve.EnsureSuccessStatusCode();

        return (revisionId, tenantId, draftAssetId);
    }

    private static IntegrationEventEnvelope BuildGisCompletedEnvelope(
        string eventId, string revisionId, string tenantId,
        IReadOnlyList<GisImportedAssetV1> imported,
        IReadOnlyList<GisImportFailureV1> failed)
    {
        var payload = JsonSerializer.Serialize(new
        {
            EventId = eventId,
            EventType = GisEventTypes.GisImportCompleted,
            EventVersion = 1,
            OccurredAt = DateTime.UtcNow,
            SourceAggregateId = revisionId,
            SourceAggregateType = "GisImportJob",
            Data = new NetworkGisImportCompletedV1(revisionId, tenantId, imported, failed)
        });
        return new IntegrationEventEnvelope(
            eventId, GisEventTypes.GisImportCompleted, 1, DateTime.UtcNow,
            tenantId, null, null, null, null,
            "water-network-gis-be",
            payload);
    }

    [Fact]
    public async Task HandleEnvelope_AllImported_MovesRevisionToPublished_AndPersistsReport()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = AuthClient(factory);
        var (revisionId, tenantId, draftAssetId) = await SeedApprovedRevision(client);

        var imported = new[] { new GisImportedAssetV1(draftAssetId, "node-x", "Node", "N-1") };
        var failed = Array.Empty<GisImportFailureV1>();
        var envelope = BuildGisCompletedEnvelope(Guid.NewGuid().ToString(), revisionId, tenantId, imported, failed);

        using var scope = factory.Services.CreateScope();
        var consumer = Microsoft.Extensions.DependencyInjection.ActivatorUtilities
            .CreateInstance<GisImportCompletedConsumer>(scope.ServiceProvider);

        await consumer.HandleEnvelopeAsync(envelope, default);

        // Assert revision is now Published
        var revisionRepo = scope.ServiceProvider.GetRequiredService<IDesignRevisionRepository>();
        var revision = await revisionRepo.GetByIdAsync(revisionId, default);
        revision.Should().NotBeNull();
        revision!.Status.Should().Be(DesignRevisionStatus.Published,
            "all assets imported → revision should be Published");

        // Assert import report persisted with the imported row
        var resultStore = scope.ServiceProvider.GetRequiredService<IDesignImportResultStore>();
        var rows = await resultStore.ListAsync(tenantId, revisionId, default);
        rows.Should().ContainSingle(r => r.DraftAssetId == draftAssetId && r.GisAssetId == "node-x" && r.Status == "imported",
            "the imported asset row should be persisted with GisAssetId");
    }

    [Fact]
    public async Task HandleEnvelope_WithFailures_MovesRevisionToPartiallyPublished_AndPersistsReport()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = AuthClient(factory);
        var (revisionId, tenantId, draftAssetId) = await SeedApprovedRevision(client);

        // Seed a second draft for the failure
        var draftBody2 = new
        {
            kind = "Node",
            assetCode = "ND-GIS-2",
            clientRef = (string?)null,
            geometry = new { type = "Point", coordinates = new[] { new[] { 105.9, 21.1 } } },
            attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
        };

        // Note: we can't add drafts after approval, so use separate asset IDs in the gis event payload
        // The consumer doesn't validate that draftAssetId exists in DB — it just saves the report.
        var imported = new[] { new GisImportedAssetV1(draftAssetId, "node-y", "Node", "N-1") };
        var failed = new[] { new GisImportFailureV1("d2-fake", "P-1", "duplicate") };
        var envelope = BuildGisCompletedEnvelope(Guid.NewGuid().ToString(), revisionId, tenantId, imported, failed);

        using var scope = factory.Services.CreateScope();
        var consumer = Microsoft.Extensions.DependencyInjection.ActivatorUtilities
            .CreateInstance<GisImportCompletedConsumer>(scope.ServiceProvider);

        await consumer.HandleEnvelopeAsync(envelope, default);

        // Assert revision is PartiallyPublished
        var revisionRepo = scope.ServiceProvider.GetRequiredService<IDesignRevisionRepository>();
        var revision = await revisionRepo.GetByIdAsync(revisionId, default);
        revision.Should().NotBeNull();
        revision!.Status.Should().Be(DesignRevisionStatus.PartiallyPublished,
            "imported=1, failed=1 → revision should be PartiallyPublished");

        // Assert report has both imported and failed rows
        var resultStore = scope.ServiceProvider.GetRequiredService<IDesignImportResultStore>();
        var rows = await resultStore.ListAsync(tenantId, revisionId, default);
        rows.Should().ContainSingle(r => r.DraftAssetId == draftAssetId && r.Status == "imported",
            "the imported asset row should be present");
        rows.Should().ContainSingle(r => r.DraftAssetId == "d2-fake" && r.Status == "failed" && r.Reason == "duplicate",
            "the failed asset row should be present");
    }
}
