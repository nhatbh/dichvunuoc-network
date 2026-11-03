using WaterNetwork.Asset.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Asset.Domain.Repositories;

public interface INetworkAssetRepository : IAggregateRepository<NetworkAsset>
{
    Task<bool> ExistsAsync(string assetId, CancellationToken ct = default);
    Task<NetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
}
