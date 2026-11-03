using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface IGeometryVersionReadDao
{
    /// <summary>
    /// Returns all geometry versions recorded for the given asset, newest first.
    /// </summary>
    /// <remarks>
    /// The <c>geometry_versions</c> table has no <c>tenant_id</c> column.
    /// Tenant isolation is inherited from the global uniqueness of asset IDs
    /// (node-&lt;uuid7&gt; values are unique across all tenants), so the DAO scopes
    /// only by <paramref name="assetId"/>.  Callers are responsible for validating
    /// the tenant token before invoking this method — the query handler does this.
    /// </remarks>
    Task<IReadOnlyList<GeometryVersionDto>> ListByAssetAsync(string assetId, CancellationToken ct = default);
}
