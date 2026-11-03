using WaterNetwork.Gis.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Aggregates;

/// <summary>Transient aggregate whose only job is to carry the import-completed domain event into
/// the outbox. Not persisted to a table of its own — the import consumer enqueues its domain
/// events only.</summary>
public sealed class GisImportBatch : AggregateRoot
{
    private GisImportBatch(string id) : base(id, version: 0) { }

    public static GisImportBatch Completed(
        string revisionId,
        string tenantId,
        IReadOnlyList<GisImportedAsset> imported,
        IReadOnlyList<GisImportFailure> failed)
    {
        var batch = new GisImportBatch(revisionId);
        batch.AddDomainEvent(new NetworkGisImportCompleted(revisionId,
            new NetworkGisImportCompletedData(revisionId, tenantId, imported, failed)));
        return batch;
    }
}
