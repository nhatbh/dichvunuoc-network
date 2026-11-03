using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignRevisionRepository(
    DesignDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<DesignRevision>(dbContext, eventDispatcher, outboxRepository), IDesignRevisionRepository
{
    public async Task<int> GetNextRevisionNumberAsync(string tenantId, string projectId, CancellationToken ct = default)
    {
        var max = await dbContext.Set<DesignRevisionPersistenceModel>()
            .Where(x => x.TenantId == tenantId && x.ProjectId == projectId)
            .Select(x => (int?)x.RevisionNumber)
            .MaxAsync(ct);
        return (max ?? 0) + 1;
    }

    public override async Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignRevisionPersistenceModel>().AsNoTracking()
            .Include(x => x.Transitions)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : ToDomain(m);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Design revisions are not deleted in DSN-2.");

    protected override async Task PersistAsync(DesignRevision aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.Set<DesignRevisionPersistenceModel>()
            .Include(x => x.Transitions)
            .FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            if (expectedVersion > 0)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            dbContext.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);
            existing.Status = aggregate.Status.ToString();
            existing.ValidationResultJson = Serialize(aggregate.ValidationResult);
            existing.NetworkEditsJson = aggregate.NetworkEdits is null ? null : JsonSerializer.Serialize(aggregate.NetworkEdits);
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;

            // Append-only transitions: insert the ones added since the last persist.
            foreach (var t in aggregate.Transitions.Skip(existing.Transitions.Count))
                existing.Transitions.Add(ToTransitionModel(aggregate, t));
        }
    }

    private static DesignRevisionPersistenceModel ToModel(DesignRevision r) => new()
    {
        Id = r.Id,
        ProjectId = r.ProjectId,
        TenantId = r.TenantId,
        RevisionNumber = r.RevisionNumber,
        Status = r.Status.ToString(),
        ValidationResultJson = Serialize(r.ValidationResult),
        NetworkEditsJson = r.NetworkEdits is null ? null : JsonSerializer.Serialize(r.NetworkEdits),
        Version = r.Version,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt,
        Transitions = r.Transitions.Select(t => ToTransitionModel(r, t)).ToList()
    };

    private static DesignRevisionTransitionPersistenceModel ToTransitionModel(DesignRevision r, DesignRevisionTransition t) => new()
    {
        RevisionId = r.Id,
        TenantId = r.TenantId,
        FromStatus = t.FromStatus.ToString(),
        ToStatus = t.ToStatus.ToString(),
        ActorId = t.ActorId,
        Reason = t.Reason,
        CorrelationId = t.CorrelationId,
        OccurredAt = t.OccurredAt
    };

    private static DesignRevision ToDomain(DesignRevisionPersistenceModel m) => DesignRevision.Reconstitute(
        m.Id, m.ProjectId, m.TenantId, m.RevisionNumber,
        Enum.Parse<DesignRevisionStatus>(m.Status), Deserialize(m.ValidationResultJson),
        m.Version, m.CreatedAt, m.UpdatedAt,
        m.Transitions
            .OrderBy(t => t.OccurredAt).ThenBy(t => t.Id)
            .Select(t => new DesignRevisionTransition(
                Enum.Parse<DesignRevisionStatus>(t.FromStatus), Enum.Parse<DesignRevisionStatus>(t.ToStatus),
                t.ActorId, t.Reason, t.CorrelationId, t.OccurredAt)),
        m.NetworkEditsJson is null ? null : JsonSerializer.Deserialize<List<NetworkEditOperation>>(m.NetworkEditsJson));

    private static string? Serialize(ValidationResult? r) => r is null ? null : JsonSerializer.Serialize(r);
    private static ValidationResult? Deserialize(string? json)
        => string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<ValidationResult>(json);
}
