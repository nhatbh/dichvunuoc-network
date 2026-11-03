// extern alias for GisApi.Program — needed because both Program classes live in the global
// namespace; the GIS project reference carries the alias "GisApi" in the .csproj.
extern alias GisApi;

using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection.Extensions;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Consumers;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

/// <summary>
/// DSN-4 full publish round-trip (design → gis → design), consumer-driven:
///   HOP 1: RevisionApprovedPublishConsumer   → design outbox: DesignAssetReadyForGis
///   HOP 2: DesignAssetImportConsumer (GIS)   → gis outbox:    NetworkGisImportCompleted
///   HOP 3: GisImportCompletedConsumer        → design revision: PartiallyPublished
///
/// Partial-failure scenario: N-2 is pre-seeded in the GIS DB so its import collides.
/// N-1 + pipe resolution depends on whether both endpoints survive; see assertion note.
/// </summary>
public sealed class PublishRoundTripTests : IAsyncLifetime
{
    // ── Two independent PostGIS containers, one per service ──────────────────────────────
    private readonly PostgisFixture _designDb = new();
    private readonly PostgisFixture _gisDb = new();

    public async Task InitializeAsync()
    {
        // Start both containers in parallel
        await Task.WhenAll(_designDb.InitializeAsync(), _gisDb.InitializeAsync());
    }

    public async Task DisposeAsync()
    {
        await Task.WhenAll(_designDb.DisposeAsync(), _gisDb.DisposeAsync());
    }

    // ── Inline GIS factory (mirrors WaterNetwork.Gis.IntegrationTests.GisApiFactory) ────
    private sealed class LocalGisApiFactory(PostgisFixture postgis)
        : WebApplicationFactory<GisApi::Program>
    {
        protected override IHost CreateHost(IHostBuilder builder)
        {
            builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:PostgreSQL"] = postgis.ConnectionString,
                    ["ConnectionStrings:Redis"] = "",
                    ["EventBus:Transport"] = "InMemory",
                    ["Database:ApplyMigrationsOnStartup"] = "false",
                    ["Jwt:Mode"] = "Mock"
                }));
            var host = base.CreateHost(builder);
            using var scope = host.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<GisDbContext>().Database.Migrate();
            return host;
        }
    }

    // ── Static coordinate arrays (CA1861: avoid constant array arguments) ───────────────
    private static readonly double[] PointN1 = [105.8, 21.0];
    private static readonly double[] PointN2 = [105.9, 21.1];
    private static readonly double[] LineStart = [105.8, 21.0];
    private static readonly double[] LineEnd = [105.9, 21.1];

    // ── Helpers ──────────────────────────────────────────────────────────────────────────

    private static HttpClient AuthClient(DesignApiFactory factory, string tenantId)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(),
            subject: "actor-rt",
            tenantId: tenantId,
            permissions: ["network-design:write", "network-design:read", "network-design:approve"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>
    /// Seeds: N-1 (clientRef "cr-n1"), N-2 (clientRef "cr-n2"), P-1 (fromRef "cr-n1", toRef "cr-n2").
    /// Returns (revisionId, draftN1Id, draftN2Id, draftPipeId).
    /// </summary>
    private static async Task<(string revisionId, string draftN1Id, string draftN2Id, string draftPipeId)>
        SeedApprovedRevisionWithDrafts(HttpClient client, string tenantId)
    {
        var proj = await client.PostAsJsonAsync("/api/design/projects",
            new { name = "RT-" + Guid.CreateVersion7() });
        proj.EnsureSuccessStatusCode();
        var projectId = (await proj.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var rev = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        rev.EnsureSuccessStatusCode();
        var revisionId = (await rev.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        // N-1 node
        var n1Resp = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", new
        {
            kind = "Node",
            assetCode = "N-1",
            clientRef = "cr-n1",
            geometry = new { type = "Point", coordinates = new[] { PointN1 } },
            attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
        });
        n1Resp.EnsureSuccessStatusCode();
        var draftN1Id = (await n1Resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        // N-2 node (its AssetCode will collide in GIS)
        var n2Resp = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", new
        {
            kind = "Node",
            assetCode = "N-2",
            clientRef = "cr-n2",
            geometry = new { type = "Point", coordinates = new[] { PointN2 } },
            attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
        });
        n2Resp.EnsureSuccessStatusCode();
        var draftN2Id = (await n2Resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        // P-1 pipe (fromRef → cr-n1, toRef → cr-n2)
        var pipeResp = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", new
        {
            kind = "Pipe",
            assetCode = "P-1",
            clientRef = (string?)null,
            geometry = new
            {
                type = "LineString",
                coordinates = new[] { LineStart, LineEnd }
            },
            attributes = new Dictionary<string, string>
            {
                ["diameterMm"] = "100",
                ["material"] = "HDPE"
            },
            fromRef = "cr-n1",
            toRef = "cr-n2",
            hostRef = (string?)null
        });
        pipeResp.EnsureSuccessStatusCode();
        var draftPipeId = (await pipeResp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        // Walk: validate → submit → approve
        (await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null)).EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null)).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/approve",
            new { reason = "round-trip test" })).EnsureSuccessStatusCode();

        return (revisionId, draftN1Id, draftN2Id, draftPipeId);
    }

    /// <summary>Builds a design.revision.approved envelope to feed into hop 1.</summary>
    private static IntegrationEventEnvelope BuildApprovedEnvelope(
        string revisionId, string projectId, string tenantId, string actorId)
    {
        var payload = JsonSerializer.Serialize(new
        {
            EventId = Guid.NewGuid().ToString(),
            EventType = DesignEventTypes.RevisionApproved,
            EventVersion = 1,
            OccurredAt = DateTime.UtcNow,
            SourceAggregateId = revisionId,
            SourceAggregateType = "DesignRevision",
            Data = new DesignRevisionApprovedV1(revisionId, projectId, tenantId, 1, actorId, "round-trip test")
        });
        return new IntegrationEventEnvelope(
            Guid.NewGuid().ToString(), DesignEventTypes.RevisionApproved, 1, DateTime.UtcNow,
            tenantId, null, null, null, null,
            "water-network-design-be",
            payload);
    }

    // ── Test ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FullRoundTrip_ApprovedRevision_ResultsInPartiallyPublished()
    {
        const string tenantId = "tenant-rt";
        const string actorId = "actor-rt";

        // ── boot both factories ──────────────────────────────────────────────────────────
        await using var designFactory = new DesignApiFactory(_designDb);
        await using var gisFactory = new LocalGisApiFactory(_gisDb);

        // ── Seed design revision (N-1, N-2, P-1) ────────────────────────────────────────
        using var designClient = AuthClient(designFactory, tenantId);
        var (revisionId, draftN1Id, draftN2Id, draftPipeId) =
            await SeedApprovedRevisionWithDrafts(designClient, tenantId);

        // ── Pre-create N-2 in GIS DB so its import will collide ──────────────────────────
        {
            using var gisScope = gisFactory.Services.CreateScope();
            var nodeRepo = gisScope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();
            var seededNode = NetworkNode.Register(
                tenantId,
                new AssetCode("N-2"),
                NodeType.Junction,
                new GeoPoint(21.1, 105.9));
            await nodeRepo.SaveAsync(seededNode);
        }

        // ══════════════════════════════════════════════════════════════════════════════════
        // HOP 1 — design: RevisionApprovedPublishConsumer → outbox: DesignAssetReadyForGis
        // ══════════════════════════════════════════════════════════════════════════════════

        // We need the projectId to build the envelope; grab it from the revision record.
        string projectId;
        {
            using var scope = designFactory.Services.CreateScope();
            var revRepo = scope.ServiceProvider.GetRequiredService<IDesignRevisionRepository>();
            var rev = await revRepo.GetByIdAsync(revisionId, default);
            projectId = rev!.ProjectId;
        }

        var approvedEnvelope = BuildApprovedEnvelope(revisionId, projectId, tenantId, actorId);

        {
            using var scope = designFactory.Services.CreateScope();
            var consumer = scope.ServiceProvider.GetRequiredService<RevisionApprovedPublishConsumer>();
            await consumer.HandleEnvelopeAsync(approvedEnvelope, default);
        }

        // ── Drain design outbox for DesignAssetReadyForGis ───────────────────────────────
        OutboxEntry readyForGisEntry;
        {
            using var scope = designFactory.Services.CreateScope();
            var outbox = scope.ServiceProvider.GetRequiredService<IOutboxRepository>();
            var pending = await outbox.GetPendingAsync(100, default);
            readyForGisEntry = pending
                .Where(e => e.EventType == nameof(WaterNetwork.Design.Domain.DomainEvents.DesignAssetReadyForGis)
                            && e.AggregateId == revisionId)
                .OrderByDescending(e => e.CreatedAt)
                .First();
        }

        // ── Build the ready-for-gis envelope for hop 2 ──────────────────────────────────
        // Outbox payload is the serialized domain event: { AggregateId, Data: { ProjectId, TenantId, RevisionNumber, ApprovedBy, Assets } }
        // RevisionId is not in Data — it's the AggregateId. We inject it manually.
        IntegrationEventEnvelope readyForGisEnvelope;
        {
            using var doc = JsonDocument.Parse(readyForGisEntry.Payload);
            var domainData = doc.RootElement.GetProperty("Data");

            // Re-shape DraftAssetSnapshot[] (domain) → ReadyForGisAssetV1[] (contract)
            // Field names are identical; we just re-serialize through the V1 record.
            var assets = domainData.GetProperty("Assets")
                .EnumerateArray()
                .Select(a => new ReadyForGisAssetV1(
                    DraftAssetId: a.GetProperty("DraftAssetId").GetString()!,
                    Kind: a.GetProperty("Kind").GetString()!,
                    AssetCode: a.GetProperty("AssetCode").GetString()!,
                    ClientRef: a.TryGetProperty("ClientRef", out var cr) ? cr.GetString() : null,
                    Geometry: new ReadyForGisGeometryV1(
                        a.GetProperty("Geometry").GetProperty("Type").GetString()!,
                        a.GetProperty("Geometry").GetProperty("Coordinates")
                            .EnumerateArray()
                            .Select(coord => (IReadOnlyList<double>)coord.EnumerateArray()
                                .Select(x => x.GetDouble()).ToArray())
                            .ToArray()),
                    Attributes: a.GetProperty("Attributes")
                        .EnumerateObject()
                        .ToDictionary(p => p.Name, p => p.Value.GetString()!),
                    FromRef: a.TryGetProperty("FromRef", out var fr) ? fr.GetString() : null,
                    ToRef: a.TryGetProperty("ToRef", out var tr) ? tr.GetString() : null,
                    HostRef: a.TryGetProperty("HostRef", out var hr) ? hr.GetString() : null))
                .ToList();

            var v1 = new DesignAssetReadyForGisV1(
                RevisionId: readyForGisEntry.AggregateId,           // RevisionId from AggregateId column
                ProjectId: domainData.GetProperty("ProjectId").GetString()!,
                TenantId: domainData.GetProperty("TenantId").GetString()!,
                RevisionNumber: domainData.GetProperty("RevisionNumber").GetInt32(),
                ApprovedBy: domainData.GetProperty("ApprovedBy").GetString()!,
                Assets: assets);

            var envelopePayload = JsonSerializer.Serialize(new { Data = v1 });
            readyForGisEnvelope = new IntegrationEventEnvelope(
                Guid.NewGuid().ToString(),
                DesignEventTypes.AssetReadyForGis,
                1,
                DateTime.UtcNow,
                tenantId, null, null, null, null,
                "water-network-design-be",
                envelopePayload);
        }

        // ══════════════════════════════════════════════════════════════════════════════════
        // HOP 2 — gis: DesignAssetImportConsumer → outbox: NetworkGisImportCompleted
        // ══════════════════════════════════════════════════════════════════════════════════

        {
            using var scope = gisFactory.Services.CreateScope();
            var consumer = scope.ServiceProvider.GetRequiredService<DesignAssetImportConsumer>();
            await consumer.HandleEnvelopeAsync(readyForGisEnvelope, default);
        }

        // ── Assert GIS DB: N-1 created, N-2 NOT duplicated ──────────────────────────────
        {
            using var scope = gisFactory.Services.CreateScope();
            var nodeRepo = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();
            (await nodeRepo.ExistsByAssetCodeAsync(tenantId, "N-1")).Should().BeTrue("N-1 must have been imported");
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            db.ChangeTracker.Clear();
            var n2Count = await db.NetworkNodes.CountAsync(n => n.TenantId == tenantId && n.AssetCode == "N-2");
            n2Count.Should().Be(1, "N-2 was pre-seeded; import collision must not duplicate it");
        }

        // ── Drain GIS outbox for NetworkGisImportCompleted ───────────────────────────────
        OutboxEntry gisCompletedEntry;
        {
            using var scope = gisFactory.Services.CreateScope();
            var outbox = scope.ServiceProvider.GetRequiredService<IOutboxRepository>();
            var pending = await outbox.GetPendingAsync(100, default);
            gisCompletedEntry = pending
                .Where(e => e.EventType == nameof(WaterNetwork.Gis.Domain.DomainEvents.NetworkGisImportCompleted)
                            && e.AggregateId == revisionId)
                .OrderByDescending(e => e.CreatedAt)
                .First();
        }

        // ── Build the gis-import-completed envelope for hop 3 ───────────────────────────
        // Domain Data fields (RevisionId, TenantId, Imported[{DraftAssetId,GisAssetId,Kind,AssetCode}],
        // Failed[{DraftAssetId,AssetCode,Reason}]) match the V1 contract 1:1 except for casing.
        // We deserialise through the V1 record to get the real import outcome.
        IntegrationEventEnvelope gisCompletedEnvelope;
        {
            using var doc = JsonDocument.Parse(gisCompletedEntry.Payload);
            var domainData = doc.RootElement.GetProperty("Data");

            var imported = domainData.GetProperty("Imported")
                .EnumerateArray()
                .Select(i => new GisImportedAssetV1(
                    i.GetProperty("DraftAssetId").GetString()!,
                    i.GetProperty("GisAssetId").GetString()!,
                    i.GetProperty("Kind").GetString()!,
                    i.GetProperty("AssetCode").GetString()!))
                .ToList();

            var failed = domainData.GetProperty("Failed")
                .EnumerateArray()
                .Select(f => new GisImportFailureV1(
                    f.GetProperty("DraftAssetId").GetString()!,
                    f.GetProperty("AssetCode").GetString()!,
                    f.GetProperty("Reason").GetString()!))
                .ToList();

            var v1 = new NetworkGisImportCompletedV1(
                RevisionId: domainData.GetProperty("RevisionId").GetString()!,
                TenantId: domainData.GetProperty("TenantId").GetString()!,
                Imported: imported,
                Failed: failed);

            var envelopePayload = JsonSerializer.Serialize(new { Data = v1 });
            gisCompletedEnvelope = new IntegrationEventEnvelope(
                Guid.NewGuid().ToString(),
                GisEventTypes.GisImportCompleted,
                1,
                DateTime.UtcNow,
                tenantId, null, null, null, null,
                "water-network-gis-be",
                envelopePayload);

            // Assert the GIS outcome contains the expected partial failure before passing it on
            failed.Should().ContainSingle(f => f.AssetCode == "N-2",
                "N-2 must have failed because it was pre-seeded (AssetCode collision)");
        }

        // ══════════════════════════════════════════════════════════════════════════════════
        // HOP 3 — design: GisImportCompletedConsumer → revision: PartiallyPublished
        // ══════════════════════════════════════════════════════════════════════════════════

        {
            using var scope = designFactory.Services.CreateScope();
            var consumer = ActivatorUtilities.CreateInstance<GisImportCompletedConsumer>(scope.ServiceProvider);
            await consumer.HandleEnvelopeAsync(gisCompletedEnvelope, default);
        }

        // ── Final assertions ─────────────────────────────────────────────────────────────
        {
            using var scope = designFactory.Services.CreateScope();

            // Revision must be PartiallyPublished (N-2 failed → not all assets imported)
            var revRepo = scope.ServiceProvider.GetRequiredService<IDesignRevisionRepository>();
            var revision = await revRepo.GetByIdAsync(revisionId, default);
            revision.Should().NotBeNull();
            revision!.Status.Should().Be(DesignRevisionStatus.PartiallyPublished,
                "N-2 import collided → not all assets imported → PartiallyPublished");

            // Import report must have a failed row for the N-2 draft
            var resultStore = scope.ServiceProvider.GetRequiredService<IDesignImportResultStore>();
            var rows = await resultStore.ListAsync(tenantId, revisionId, default);

            rows.Should().Contain(r => r.DraftAssetId == draftN2Id && r.Status == "failed",
                "N-2 draft must appear in the import report as failed");

            // Cascade: P-1's toRef "cr-n2" cannot resolve because N-2 collided and never entered the refMap → P-1 also fails.
            rows.Should().Contain(r => r.DraftAssetId == draftPipeId && r.Status == "failed",
                "P-1 must fail: its toRef 'cr-n2' is unresolved after N-2's collision");
            // Only N-1 imports successfully.
            rows.Should().ContainSingle(r => r.Status == "imported",
                "only N-1 should import; N-2 and P-1 both fail");
        }
    }

    [Fact]
    public async Task NetworkEdits_Save_Reload_Approve_Apply_And_Report_Published()
    {
        const string tenant = "tenant-edit-roundtrip";
        await using var gisFactory = new LocalGisApiFactory(_gisDb);
        using var gisClient = gisFactory.CreateClient();
        gisClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            DevJwtTokenFactory.CreateTokenForAuthorizedParty(new JwtOptions(), "editor", tenant, "water-network-gis-fe", permissions: ["network-gis:read"]));
        await using var original = new DesignApiFactory(_designDb);
        await using var designFactory = original.WithWebHostBuilder(b => b.ConfigureServices(services =>
        {
            services.RemoveAll<IGisLookupPort>();
            services.AddSingleton<IGisLookupPort>(new WaterNetwork.Design.Infrastructure.GisLookup.HttpGisLookupAdapter(gisClient));
        }));
        using var client = designFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "editor", tenantId: tenant,
                permissions: ["network-design:read", "network-design:write", "network-design:approve"]));
        var projectResponse = await client.PostAsJsonAsync("/api/design/projects", new {name="Network edit roundtrip"});
        projectResponse.EnsureSuccessStatusCode();
        var projectId = (await projectResponse.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var revisionResponse = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        revisionResponse.EnsureSuccessStatusCode();
        var id = (await revisionResponse.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var editPath = $"/api/design/revisions/{id}/network-edits";
        var initial = await client.GetFromJsonAsync<JsonNode>(editPath);
        var operations = new NetworkEditOperationV1[]
        {
            new("n1", "Add", "Node", null, null, new("n1","Node","EDIT-N1","n1",new("Point",[[105,21]]),new Dictionary<string,string>{{"nodeType","Junction"}},null,null,null),null),
            new("n2", "Add", "Node", null, null, new("n2","Node","EDIT-N2","n2",new("Point",[[105.001,21]]),new Dictionary<string,string>{{"nodeType","Junction"}},null,null,null),null),
            new("p", "Add", "Pipe", null, null, new("p","Pipe","EDIT-P1","p",new("LineString",[[105,21],[105.001,21]]),new Dictionary<string,string>{{"diameterMm","100"},{"material","HDPE"}},"n1","n2",null),null)
        };
        var save = await client.PutAsJsonAsync(editPath,new {expectedVersion=initial!["version"]!.GetValue<int>(),operations});
        save.EnsureSuccessStatusCode();
        (await client.GetFromJsonAsync<JsonNode>(editPath))!["operations"]!.AsArray().Count.Should().Be(3);
        var validation = await client.PostAsync($"/api/design/revisions/{id}/validate",null);
        validation.EnsureSuccessStatusCode();
        (await validation.Content.ReadFromJsonAsync<JsonNode>())!["isValid"]!.GetValue<bool>().Should().BeTrue();
        (await client.PostAsync($"/api/design/revisions/{id}/submit",null)).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/design/revisions/{id}/approve",new {reason="fixture"})).EnsureSuccessStatusCode();
        using(var scope=designFactory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<RevisionApprovedPublishConsumer>().HandleEnvelopeAsync(BuildApprovedEnvelope(id,projectId,tenant,"editor"),default);
        IntegrationEventEnvelope ready;
        using(var scope=designFactory.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<DesignDbContext>();
            var entry=await db.OutboxEntries.Where(x=>x.AggregateId==id && x.EventType=="DesignNetworkEditsReady").OrderByDescending(x=>x.CreatedAt).FirstAsync();
            var domain=JsonSerializer.Deserialize<WaterNetwork.Design.Domain.DomainEvents.DesignNetworkEditsReady>(entry.Payload)!;
            var mapped=new WaterNetwork.Design.Infrastructure.IntegrationEvents.DesignIntegrationEventMapper().Map(domain)!;
            ready=new(Guid.NewGuid().ToString(),"design.network-edits.ready",1,DateTime.UtcNow,entry.TenantId,null,null,null,null,"water-network-design-be",JsonSerializer.Serialize(mapped,mapped.GetType()));
        }
        IntegrationEventEnvelope completed;
        using(var scope=gisFactory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<NetworkEditsPublishConsumer>().HandleEnvelopeAsync(ready,default);
            var db=scope.ServiceProvider.GetRequiredService<GisDbContext>();
            (await db.NetworkNodes.CountAsync(x=>x.TenantId==tenant)).Should().Be(2);
            (await db.NetworkPipes.CountAsync(x=>x.TenantId==tenant)).Should().Be(1);
            var entry=await db.OutboxEntries.SingleAsync(x=>x.AggregateId==id && x.EventType=="NetworkGisImportCompleted");
            var domain=JsonSerializer.Deserialize<WaterNetwork.Gis.Domain.DomainEvents.NetworkGisImportCompleted>(entry.Payload)!;
            var mapped=new WaterNetwork.Gis.Infrastructure.IntegrationEvents.GisIntegrationEventMapper().Map(domain)!;
            completed=new(Guid.NewGuid().ToString(),GisEventTypes.GisImportCompleted,1,DateTime.UtcNow,entry.TenantId,null,null,null,null,"water-network-gis-be",JsonSerializer.Serialize(mapped,mapped.GetType()));
        }
        using(var scope=designFactory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<GisImportCompletedConsumer>().HandleEnvelopeAsync(completed,default);
        var final=await client.GetFromJsonAsync<JsonNode>(editPath);
        final!["status"]!.GetValue<string>().Should().Be("Published");
        var results=await client.GetFromJsonAsync<JsonArray>($"/api/design/revisions/{id}/publish-result");
        results!.Count.Should().Be(3);
        results.All(x=>x!["status"]!.GetValue<string>()=="imported").Should().BeTrue();
    }
}
