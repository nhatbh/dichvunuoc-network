using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Transient-aggregate repository: no table row is written; the base class
/// collects the GisImportBatch domain events and routes them to the outbox atomically.
/// </summary>
public sealed class GisImportBatchRepository(
    GisDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<GisImportBatch>(dbContext, eventDispatcher, outboxRepository),
      IGisImportBatchRepository
{
    /// <summary>
    /// Explicit implementation satisfies <see cref="IGisImportBatchRepository.SaveAsync"/> (returns Task)
    /// while the base's SaveAsync returns Task&lt;GisImportBatch&gt;.
    /// </summary>
    async Task IGisImportBatchRepository.SaveAsync(GisImportBatch batch, CancellationToken ct)
        => await base.SaveAsync(batch, ct);

    /// <summary>No table — nothing to stage. The base class owns SaveChangesAsync.</summary>
    protected override Task PersistAsync(GisImportBatch aggregate, int expectedVersion, CancellationToken ct)
        => Task.CompletedTask;

    /// <summary>Not needed: this aggregate is write-only (carry events to outbox).</summary>
    public override Task<GisImportBatch?> GetByIdAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("GisImportBatch is a transient aggregate; read-back is not supported.");

    /// <summary>Not needed: this aggregate is write-only.</summary>
    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("GisImportBatch is a transient aggregate; delete is not supported.");
}
