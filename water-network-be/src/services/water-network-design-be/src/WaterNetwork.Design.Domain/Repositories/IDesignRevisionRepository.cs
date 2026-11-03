using WaterNetwork.Design.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDesignRevisionRepository : IAggregateRepository<DesignRevision>
{
    Task<int> GetNextRevisionNumberAsync(string tenantId, string projectId, CancellationToken ct = default);
}
