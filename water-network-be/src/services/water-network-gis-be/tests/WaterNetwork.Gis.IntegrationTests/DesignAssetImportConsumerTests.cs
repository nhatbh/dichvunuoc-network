using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class DesignAssetImportConsumerTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    // ── helpers ───────────────────────────────────────────────────────────────────────────────

    private static async Task MigrateAsync(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await db.Database.MigrateAsync();
    }

    /// <summary>
    /// Build an <see cref="IntegrationEventEnvelope"/> that wraps a <see cref="DesignAssetReadyForGisV1"/>
    /// the same way the design-be outbox mapper would: payload is <c>{ "Data": &lt;DesignAssetReadyForGisV1&gt; }</c>.
    /// </summary>
    private static IntegrationEventEnvelope MakeEnvelope(string eventId, DesignAssetReadyForGisV1 data)
        => new(
            EventId: eventId,
            EventType: DesignEventTypes.AssetReadyForGis,
            EventVersion: 1,
            OccurredAt: DateTime.UtcNow,
            TenantId: data.TenantId,
            OrganizationId: null,
            BranchId: null,
            CorrelationId: null,
            CausationId: null,
            Producer: "water-network-design-be",
            Payload: JsonSerializer.Serialize(new { Data = data }));

    /// <summary>Create a minimal Node asset for the batch.</summary>
    private static ReadyForGisAssetV1 NodeAsset(string draftId, string assetCode, string? clientRef,
        double lat = 10.762622, double lng = 106.660172)
        => new(
            DraftAssetId: draftId,
            Kind: "Node",
            AssetCode: assetCode,
            ClientRef: clientRef,
            Geometry: new ReadyForGisGeometryV1("Point", [new double[] { lng, lat }]),
            Attributes: new Dictionary<string, string> { ["nodeType"] = "Junction" },
            FromRef: null,
            ToRef: null,
            HostRef: null);

    // Static arrays avoid CA1861 (constant array arguments).
    private static readonly double[] PipePoint1 = [106.660172, 10.762622];
    private static readonly double[] PipePoint2 = [106.661000, 10.763000];

    /// <summary>Create a minimal Pipe asset referencing two nodes by their clientRefs.</summary>
    private static ReadyForGisAssetV1 PipeAsset(string draftId, string assetCode, string fromRef, string toRef)
        => new(
            DraftAssetId: draftId,
            Kind: "Pipe",
            AssetCode: assetCode,
            ClientRef: null,
            Geometry: new ReadyForGisGeometryV1("LineString",
                [PipePoint1, PipePoint2]),
            Attributes: new Dictionary<string, string>
            {
                ["diameterMm"] = "100",
                ["material"] = "HDPE"
            },
            FromRef: fromRef,
            ToRef: toRef,
            HostRef: null);

    // ── tests ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Test 1: All-success — 2 nodes + 1 pipe.
    /// After handling: both nodes exist in DB, ledger has an entry for the pipe draft,
    /// and the outbox contains a NetworkGisImportCompleted entry.
    /// </summary>
    [Fact]
    public async Task AllSuccess_Batch_Creates_Nodes_And_Pipe_And_Emits_Completed()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var sp = scope.ServiceProvider;
        var consumer = sp.GetRequiredService<DesignAssetImportConsumer>();
        var nodeRepo = sp.GetRequiredService<INetworkNodeRepository>();
        var ledger = sp.GetRequiredService<IGisImportLedgerStore>();
        var db = sp.GetRequiredService<GisDbContext>();

        var revisionId = $"rev-t1-{Guid.NewGuid():N}"[..20];
        var tenantId = $"tenant-import-t1-{Guid.NewGuid():N}"[..24];
        var n1Code = $"ND-T1A-{Guid.NewGuid():N}"[..16];
        var n2Code = $"ND-T1B-{Guid.NewGuid():N}"[..16];
        var pipeCode = $"PP-T1-{Guid.NewGuid():N}"[..16];
        var d1 = $"draft-n1-{Guid.NewGuid():N}"[..24];
        var d2 = $"draft-n2-{Guid.NewGuid():N}"[..24];
        var dPipe = $"draft-p-{Guid.NewGuid():N}"[..24];

        var data = new DesignAssetReadyForGisV1(
            RevisionId: revisionId,
            ProjectId: "proj-1",
            TenantId: tenantId,
            RevisionNumber: 1,
            ApprovedBy: "approver",
            Assets:
            [
                NodeAsset(d1, n1Code, "cr-n1"),
                NodeAsset(d2, n2Code, "cr-n2"),
                PipeAsset(dPipe, pipeCode, "cr-n1", "cr-n2")
            ]);

        await consumer.HandleEnvelopeAsync(MakeEnvelope(Guid.NewGuid().ToString(), data), default);

        // Both nodes exist
        var node1Exists = await nodeRepo.ExistsByAssetCodeAsync(tenantId, n1Code);
        var node2Exists = await nodeRepo.ExistsByAssetCodeAsync(tenantId, n2Code);
        node1Exists.Should().BeTrue("node 1 must have been created");
        node2Exists.Should().BeTrue("node 2 must have been created");

        // Ledger has an entry for the pipe draft
        var pipeGisId = await ledger.GetExistingAsync(revisionId, dPipe, CancellationToken.None);
        pipeGisId.Should().NotBeNull("ledger must record the pipe import");

        // Outbox has a NetworkGisImportCompleted entry
        db.ChangeTracker.Clear();
        var outboxEntry = await db.OutboxEntries
            .FirstOrDefaultAsync(e => e.EventType == nameof(NetworkGisImportCompleted)
                                   && e.AggregateId == revisionId);
        outboxEntry.Should().NotBeNull("SaveAsync must have written a NetworkGisImportCompleted outbox entry");
        outboxEntry!.Payload.Should().Contain("\"Imported\"", "payload must list imported assets");
    }

    /// <summary>
    /// Test 2: Partial failure — one asset in the batch collides; the completed event
    /// still fires but must have at least one item in Failed and zero in Imported for that asset.
    /// </summary>
    [Fact]
    public async Task PartialFailure_Collision_Records_Failed_Entry_And_Still_Emits_Completed()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var sp = scope.ServiceProvider;
        var consumer = sp.GetRequiredService<DesignAssetImportConsumer>();
        var nodeRepo = sp.GetRequiredService<INetworkNodeRepository>();
        var db = sp.GetRequiredService<GisDbContext>();

        var tenantId = $"tenant-import-t2-{Guid.NewGuid():N}"[..24];
        var revisionId = $"rev-t2-{Guid.NewGuid():N}"[..20];
        var collisionCode = $"ND-T2C-{Guid.NewGuid():N}"[..16];

        // Pre-seed a node that will collide
        var seeded = NetworkNode.Register(tenantId, new AssetCode(collisionCode), NodeType.Junction,
            new GeoPoint(10.762622, 106.660172));
        await nodeRepo.SaveAsync(seeded);

        // Batch: the seeded code (will conflict) + a fresh node
        var freshCode = $"ND-T2F-{Guid.NewGuid():N}"[..16];
        var dConflict = $"draft-col-{Guid.NewGuid():N}"[..24];
        var dFresh = $"draft-fresh-{Guid.NewGuid():N}"[..24];

        var data = new DesignAssetReadyForGisV1(
            RevisionId: revisionId,
            ProjectId: "proj-2",
            TenantId: tenantId,
            RevisionNumber: 2,
            ApprovedBy: "approver",
            Assets:
            [
                NodeAsset(dConflict, collisionCode, null),
                NodeAsset(dFresh, freshCode, null)
            ]);

        // Should NOT throw — failed assets are captured
        await consumer.HandleEnvelopeAsync(MakeEnvelope(Guid.NewGuid().ToString(), data), default);

        // The outbox entry must exist
        db.ChangeTracker.Clear();
        var outboxEntry = await db.OutboxEntries
            .FirstOrDefaultAsync(e => e.EventType == nameof(NetworkGisImportCompleted)
                                   && e.AggregateId == revisionId);
        outboxEntry.Should().NotBeNull("NetworkGisImportCompleted must be emitted even on partial failure");

        // Parse the payload to verify Failed has 1 item
        var payload = JsonDocument.Parse(outboxEntry!.Payload);
        var dataEl = payload.RootElement.GetProperty("Data");
        var failedCount = dataEl.GetProperty("Failed").GetArrayLength();
        var importedCount = dataEl.GetProperty("Imported").GetArrayLength();
        failedCount.Should().Be(1, "the colliding node must appear in Failed");
        importedCount.Should().Be(1, "the fresh node must appear in Imported");

        // No orphaned geometry_versions rows — ChangeTracker.Clear() in the catch must have
        // discarded the staged geometry row for the failed (colliding) asset before the next
        // successful SaveChangesAsync ran.
        var dbContext2 = sp.GetRequiredService<GisDbContext>();
        dbContext2.ChangeTracker.Clear();
        var geomCount = await dbContext2.GeometryVersions.CountAsync();
        geomCount.Should().Be(importedCount,
            "geometry_versions must contain exactly one row — for the successfully imported node only; " +
            "the failed asset's staged geometry row must have been discarded by ChangeTracker.Clear()");
    }

    /// <summary>
    /// Test 3: Redelivery idempotency — same (revisionId, draftId) handled twice.
    /// Second pass must skip creation via the ledger; the node still exists and there
    /// is exactly one ledger row.
    /// </summary>
    [Fact]
    public async Task Redelivery_Same_RevisionId_DraftId_Skips_Creation_Via_Ledger()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var sp = scope.ServiceProvider;
        var consumer = sp.GetRequiredService<DesignAssetImportConsumer>();
        var nodeRepo = sp.GetRequiredService<INetworkNodeRepository>();
        var ledger = sp.GetRequiredService<IGisImportLedgerStore>();

        var tenantId = $"tenant-import-t3-{Guid.NewGuid():N}"[..24];
        var revisionId = "rev-idem-t3";
        var nodeCode = $"ND-T3-{Guid.NewGuid():N}"[..16];
        var draftId = $"draft-t3-{Guid.NewGuid():N}"[..24];

        var data = new DesignAssetReadyForGisV1(
            RevisionId: revisionId,
            ProjectId: "proj-3",
            TenantId: tenantId,
            RevisionNumber: 1,
            ApprovedBy: "approver",
            Assets: [NodeAsset(draftId, nodeCode, null)]);

        // First delivery — use a unique EventId (inbox dedup key)
        await consumer.HandleEnvelopeAsync(MakeEnvelope(Guid.NewGuid().ToString(), data), default);

        // Node must exist and ledger must have an entry
        var nodeExists = await nodeRepo.ExistsByAssetCodeAsync(tenantId, nodeCode);
        nodeExists.Should().BeTrue("node must be created on first delivery");

        var gisIdAfterFirst = await ledger.GetExistingAsync(revisionId, draftId, CancellationToken.None);
        gisIdAfterFirst.Should().NotBeNull("ledger must record the import after first delivery");

        // Second delivery with DIFFERENT EventId (simulates a requeued message, not same eventId)
        // The inbox allows it (different EventId), but the ledger must short-circuit the creation.
        var act = async () =>
            await consumer.HandleEnvelopeAsync(MakeEnvelope(Guid.NewGuid().ToString(), data), default);
        await act.Should().NotThrowAsync("second delivery via ledger path must not throw");

        // Node still exists
        nodeExists = await nodeRepo.ExistsByAssetCodeAsync(tenantId, nodeCode);
        nodeExists.Should().BeTrue("node must still exist after second delivery");

        // Ledger still returns the same GIS ID — no second entry was created
        var gisIdAfterSecond = await ledger.GetExistingAsync(revisionId, draftId, CancellationToken.None);
        gisIdAfterSecond.Should().Be(gisIdAfterFirst,
            "ledger must still return the same GIS ID — ledger dedup prevented a second create");
    }
}
