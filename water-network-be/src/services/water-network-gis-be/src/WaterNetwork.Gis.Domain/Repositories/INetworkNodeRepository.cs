using WaterNetwork.Gis.Domain.Aggregates;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface INetworkNodeRepository
{
    Task<NetworkNode> SaveAsync(NetworkNode node, CancellationToken ct = default);
    Task<NetworkNode?> GetByIdAsync(string id, CancellationToken ct = default);
    Task<NetworkNode?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
    Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
}
