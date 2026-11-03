using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

/// <summary>
/// Base class for aggregate repositories that optionally route domain events through the
/// transactional outbox.
/// </summary>
/// <remarks>
/// <para>
/// When an <see cref="IOutboxRepository"/> is supplied the base class owns the transaction and
/// calls <see cref="DbContext"/>.SaveChangesAsync once, after staging both the aggregate changes
/// and the outbox rows.
/// </para>
/// <para>
/// <strong>Contract for overriding <see cref="PersistAsync"/>:</strong> implementations MUST only
/// <em>stage</em> changes (i.e. call <c>DbContext.Add</c> / <c>DbContext.Update</c> on the
/// context) and MUST NOT call <c>SaveChanges</c> / <c>SaveChangesAsync</c> themselves when the
/// outbox path is active.  The base class owns the transaction boundary and issues the single
/// <c>SaveChangesAsync</c> call that covers both the aggregate rows and the outbox rows
/// atomically.
/// </para>
/// </remarks>
public abstract class AggregateRepositoryBase<TAggregate> : IAggregateRepository<TAggregate>
    where TAggregate : AggregateRoot
{
    private readonly IDomainEventDispatcher _eventDispatcher;
    private readonly IOutboxRepository? _outboxRepository;

    /// <summary>The EF Core db context shared by this repository and the outbox repository.</summary>
    protected PlatformDbContext DbContext { get; }

    protected AggregateRepositoryBase(
        PlatformDbContext dbContext,
        IDomainEventDispatcher eventDispatcher,
        IOutboxRepository? outboxRepository = null)
    {
        DbContext = dbContext;
        _eventDispatcher = eventDispatcher;
        _outboxRepository = outboxRepository;
    }

    public async Task<TAggregate> SaveAsync(TAggregate aggregate, CancellationToken ct = default)
    {
        var events = aggregate.GetDomainEvents().ToList();
        var expectedVersion = aggregate.Version - events.Count;

        if (_outboxRepository is not null)
        {
            await PersistWithOutboxAsync(aggregate, expectedVersion, events, ct);
        }
        else
        {
            await PersistAsync(aggregate, expectedVersion, ct);
            await _eventDispatcher.DispatchAsync(events, ct);
        }

        aggregate.ClearDomainEvents();

        return aggregate;
    }

    public abstract Task<TAggregate?> GetByIdAsync(string id, CancellationToken ct = default);
    public abstract Task DeleteAsync(string id, CancellationToken ct = default);

    /// <summary>
    /// Stage aggregate changes on the db context (Add/Update). Do NOT call SaveChanges here when
    /// used alongside the outbox — the base class owns the transaction and issues the single
    /// SaveChangesAsync that covers both the aggregate and the outbox rows.
    /// </summary>
    protected abstract Task PersistAsync(TAggregate aggregate, int expectedVersion, CancellationToken ct);

    /// <summary>
    /// Persists the aggregate and its domain events to the outbox atomically. If a transaction is
    /// already ambient the work is enlisted into it; otherwise a new transaction is started.
    /// </summary>
    protected virtual async Task PersistWithOutboxAsync(
        TAggregate aggregate, int expectedVersion, IReadOnlyList<IDomainEvent> events, CancellationToken ct)
    {
        // Already inside a caller-managed transaction — just stage and let the caller commit.
        if (DbContext.Database.CurrentTransaction is not null)
        {
            await PersistAsync(aggregate, expectedVersion, ct);
            if (events.Count > 0) await _outboxRepository!.AddManyAsync(events, ct);
            await DbContext.SaveChangesAsync(ct);
            return;
        }

        // No ambient transaction — wrap in our own to guarantee atomicity.
        var strategy = DbContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await DbContext.Database.BeginTransactionAsync(ct);
            try
            {
                await PersistAsync(aggregate, expectedVersion, ct);
                if (events.Count > 0) await _outboxRepository!.AddManyAsync(events, ct);
                await DbContext.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
            }
            catch
            {
                await transaction.RollbackAsync(ct);
                throw;
            }
        });
    }
}
