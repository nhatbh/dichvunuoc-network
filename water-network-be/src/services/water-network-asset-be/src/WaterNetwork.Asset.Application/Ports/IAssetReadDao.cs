using WaterNetwork.Asset.Application.Dtos;

namespace WaterNetwork.Asset.Application.Ports;

public interface IAssetReadDao
{
    Task<AssetDetailDto?> GetDetailAsync(string tenantId, string assetId, CancellationToken ct = default);

    Task<AssetPagedResult> GetPagedAsync(
        string tenantId,
        string? type,
        string? status,
        int page,
        int pageSize,
        CancellationToken ct = default);
}
