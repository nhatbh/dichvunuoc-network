using WaterNetwork.Gis.Domain.Aggregates;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface INetworkDeviceRepository
{
    Task<NetworkDevice> SaveAsync(NetworkDevice device, CancellationToken ct = default);
    Task<NetworkDevice?> GetByIdAsync(string id, CancellationToken ct = default);
    Task<NetworkDevice?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
    Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
    Task<bool> ExistsByHostPipeAsync(string pipeId, CancellationToken ct = default);
    Task<bool> ExistsByHostNodeAsync(string nodeId, CancellationToken ct = default);
}
