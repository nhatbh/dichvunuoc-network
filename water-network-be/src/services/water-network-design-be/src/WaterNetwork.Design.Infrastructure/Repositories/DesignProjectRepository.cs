using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignProjectRepository(
    DesignDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<DesignProject>(dbContext, eventDispatcher, outboxRepository), IDesignProjectRepository
{
    public Task<bool> ExistsByNameAsync(string tenantId, string name, CancellationToken ct = default)
        => dbContext.Set<DesignProjectPersistenceModel>().AnyAsync(x => x.TenantId == tenantId && x.Name == name, ct);

    public override async Task<DesignProject?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignProjectPersistenceModel>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : ToDomain(m);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Design projects are not deleted in DSN-1.");

    protected override async Task PersistAsync(DesignProject aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.Set<DesignProjectPersistenceModel>().FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
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
            existing.Name = aggregate.Name;
            existing.BranchId = aggregate.BranchId;
            existing.ZoneId = aggregate.ZoneId;
            existing.Status = aggregate.Status.ToString();
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
        }
    }

    private static DesignProjectPersistenceModel ToModel(DesignProject p) => new()
    {
        Id = p.Id,
        TenantId = p.TenantId,
        Name = p.Name,
        BranchId = p.BranchId,
        ZoneId = p.ZoneId,
        Status = p.Status.ToString(),
        Version = p.Version,
        CreatedAt = p.CreatedAt,
        UpdatedAt = p.UpdatedAt
    };

    private static DesignProject ToDomain(DesignProjectPersistenceModel m) => DesignProject.Reconstitute(
        m.Id, m.TenantId, m.Name, m.BranchId, m.ZoneId,
        Enum.Parse<DesignProjectStatus>(m.Status), m.Version, m.CreatedAt, m.UpdatedAt);
}
