using WaterNetwork.Gis.Application.Queries;

namespace WaterNetwork.Gis.Application.Ports;

public interface IBboxAssetReadDao
{
    /// <summary>
    /// Returns up to <paramref name="fetchLimit"/> rows of the requested asset
    /// kinds whose geometry overlaps the query bbox, scoped to the tenant.
    /// Caller passes fetchLimit = Limit+1 to detect truncation.
    /// </summary>
    Task<IReadOnlyList<BboxAssetRow>> QueryAsync(
        string tenantId, GetAssetsInBboxQuery query, int fetchLimit, CancellationToken ct = default);
}

/// <summary>Flat Dapper materialization row across the three asset tables.</summary>
public sealed record BboxAssetRow(
    string Kind,        // Node | Pipe | Device
    string Id,
    string AssetCode,
    string Status,
    string GeoJson,     // ST_AsGeoJSON(geometry|location) — raw GeoJSON geometry object
    string? NodeType,
    int? DiameterMm,
    string? Material,
    double? LengthM,
    string? FromNodeId,
    string? ToNodeId,
    string? DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    string? LifecycleStatus);
