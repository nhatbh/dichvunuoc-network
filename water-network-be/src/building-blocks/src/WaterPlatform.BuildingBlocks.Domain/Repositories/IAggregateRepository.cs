using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterPlatform.BuildingBlocks.Domain.Repositories;

public interface IAggregateRepository<TAggregate> where TAggregate : AggregateRoot
{
    Task<TAggregate> SaveAsync(TAggregate aggregate, CancellationToken ct = default);
    Task<TAggregate?> GetByIdAsync(string id, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
}
