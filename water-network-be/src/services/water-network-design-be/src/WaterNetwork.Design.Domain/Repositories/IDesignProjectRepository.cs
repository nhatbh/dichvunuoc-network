using WaterNetwork.Design.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDesignProjectRepository : IAggregateRepository<DesignProject>
{
    Task<bool> ExistsByNameAsync(string tenantId, string name, CancellationToken ct = default);
}
