using System.Text.Json;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Design.Infrastructure.Consumers;

/// <summary>Consumes network.gis-import.completed and finalises the revision: MarkPublished /
/// MarkPartiallyPublished + persists a per-draft import report.</summary>
public sealed class GisImportCompletedConsumer(
    IDesignRevisionRepository revisionRepository,
    IDesignImportResultStore resultStore,
    IInboxMessageStore inboxMessageStore)
    : IdempotentEnvelopeConsumer(inboxMessageStore)
{
    protected override string ConsumerName => "design.gis-import-completed";

    protected override bool Subscribes(string eventType) => eventType == GisEventTypes.GisImportCompleted;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data").Deserialize<NetworkGisImportCompletedV1>()
            ?? throw new InvalidOperationException("gis-import-completed payload Data did not deserialize.");

        var revision = await revisionRepository.GetByIdAsync(data.RevisionId, ct);
        if (revision is null || revision.TenantId != data.TenantId) return;

        var rows = data.Imported.Select(i => new ImportResultRow(i.DraftAssetId, i.GisAssetId, "imported", null))
            .Concat(data.Failed.Select(f => new ImportResultRow(f.DraftAssetId, null, "failed", f.Reason)))
            .ToList();
        await resultStore.SaveResultsAsync(data.TenantId, data.RevisionId, rows, ct);

        if (revision.Status == DesignRevisionStatus.Approved)
        {
            revision.MarkPublished(data.Imported.Count, data.Failed.Count,
                actorId: "gis-import", correlationId: envelope.CorrelationId);
            await revisionRepository.SaveAsync(revision, ct);
        }
    }
}
