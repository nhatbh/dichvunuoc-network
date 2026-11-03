using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

/// <summary>
/// Repository for the transactional outbox pattern.
/// </summary>
/// <remarks>
/// <strong>Delivery guarantee: AT-LEAST-ONCE.</strong>
/// <list type="bullet">
///   <item>No SKIP LOCKED / advisory lock is used, so concurrent processors may double-publish;
///   downstream consumers must be idempotent.</item>
///   <item>Entries that are left in <c>Processing</c> status after a processor crash are not
///   automatically recovered (follow-up: stale-Processing reset).</item>
/// </list>
/// </remarks>
public interface IOutboxRepository
{
    Task AddAsync(IDomainEvent domainEvent, CancellationToken ct = default);
    Task AddManyAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct = default);
    Task<IReadOnlyList<OutboxEntry>> GetPendingAsync(int limit, CancellationToken ct = default);
    Task<bool> MarkAsProcessingAsync(string id, CancellationToken ct = default);
    Task MarkAsProcessedAsync(string id, CancellationToken ct = default);
    Task MarkAsFailedAsync(string id, string errorMessage, CancellationToken ct = default);
    Task<int> DeleteProcessedAsync(DateTime olderThan, CancellationToken ct = default);
    Task<int> ResetForRetryAsync(int maxRetries, CancellationToken ct = default);
}
