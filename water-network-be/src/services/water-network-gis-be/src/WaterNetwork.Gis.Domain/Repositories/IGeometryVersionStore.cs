using WaterNetwork.Gis.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface IGeometryVersionStore
{
    Task<int> GetNextVersionAsync(string assetId, CancellationToken ct = default);
    Task AppendAsync(GeometryVersion version, CancellationToken ct = default);
    /// <summary>Lists all geometry versions for the asset, ordered by version descending (most recent first).</summary>
    Task<IReadOnlyList<GeometryVersion>> ListByAssetAsync(string assetId, CancellationToken ct = default);
}
