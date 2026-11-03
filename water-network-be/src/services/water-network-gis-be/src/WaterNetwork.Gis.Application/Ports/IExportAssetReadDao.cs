using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface IExportAssetReadDao
{
    /// <summary>Returns up to <paramref name="fetchLimit"/> live assets for the
    /// tenant with id &gt; <paramref name="afterId"/>, ordered by id ascending.</summary>
    Task<IReadOnlyList<AssetExportItemDto>> QueryAsync(
        string tenantId, string? afterId, int fetchLimit, CancellationToken ct = default);
}
