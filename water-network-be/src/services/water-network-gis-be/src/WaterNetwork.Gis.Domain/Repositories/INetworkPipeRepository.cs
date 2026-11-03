using WaterNetwork.Gis.Domain.Aggregates;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface INetworkPipeRepository
{
    Task<NetworkPipe> SaveAsync(NetworkPipe pipe, CancellationToken ct = default);
    Task<NetworkPipe?> GetByIdAsync(string id, CancellationToken ct = default);
    Task<NetworkPipe?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
    Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
    Task<bool> ExistsByEndpointNodeAsync(string nodeId, CancellationToken ct = default);
}
