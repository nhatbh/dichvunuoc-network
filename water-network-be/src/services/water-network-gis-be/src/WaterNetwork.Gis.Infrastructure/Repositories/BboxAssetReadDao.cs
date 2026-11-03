using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Dapper bbox read across the three asset tables. Each branch projects into the
/// same flat row shape (NULL-filling type-specific columns), UNION ALL'd, with a
/// single LIMIT @fetchLimit. The PostGIS <c>&amp;&amp;</c> bbox-overlap operator
/// is index-accelerated by the per-table GiST indexes. Geometry is emitted as
/// raw GeoJSON via ST_AsGeoJSON.
/// </summary>
public sealed class BboxAssetReadDao(GisDbContext dbContext) : IBboxAssetReadDao
{
    public async Task<IReadOnlyList<BboxAssetRow>> QueryAsync(
        string tenantId, GetAssetsInBboxQuery query, int fetchLimit, CancellationToken ct = default)
    {
        var selects = new List<string>(3);
        // Types are normalized to lowercase tokens by the endpoint; match directly.
        if (query.Types.Contains("node")) selects.Add(NodeSelect);
        if (query.Types.Contains("pipe")) selects.Add(PipeSelect);
        if (query.Types.Contains("device")) selects.Add(DeviceSelect);
        if (selects.Count == 0) return [];

        // ORDER BY id makes truncation membership deterministic across identical calls
        // (UNION ALL + LIMIT without ORDER BY drops arbitrary rows). id is the output
        // column from each branch's `id AS Id` projection.
        var sql = string.Join("\nUNION ALL\n", selects) + "\nORDER BY id\nLIMIT @fetchLimit";

        var parameters = new
        {
            tenantId,
            minLng = query.MinLng,
            minLat = query.MinLat,
            maxLng = query.MaxLng,
            maxLat = query.MaxLat,
            fetchLimit
        };

        var connection = dbContext.Database.GetDbConnection();
        var rows = await connection.QueryAsync<BboxAssetRow>(
            new CommandDefinition(sql, parameters, cancellationToken: ct));
        return rows.AsList();
    }

    private const string NodeSelect = """
        SELECT 'Node'                  AS Kind,
               n.id                    AS Id,
               n.asset_code            AS AssetCode,
               'Active'                AS Status,
               ST_AsGeoJSON(n.location) AS GeoJson,
               n.node_type             AS NodeType,
               NULL::int               AS DiameterMm,
               NULL::text              AS Material,
               NULL::double precision  AS LengthM,
               NULL::text              AS FromNodeId,
               NULL::text              AS ToNodeId,
               NULL::text              AS DeviceType,
               NULL::text              AS HostPipeId,
               NULL::text              AS HostNodeId,
               s.lifecycle_status      AS LifecycleStatus
        FROM network_nodes n
        LEFT JOIN network_asset_states s ON s.asset_id = n.id AND s.tenant_id = @tenantId
        WHERE n.tenant_id = @tenantId AND n.deleted_at IS NULL
          AND n.location && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;

    private const string PipeSelect = """
        SELECT 'Pipe'                  AS Kind,
               p.id                    AS Id,
               p.asset_code            AS AssetCode,
               p.status                AS Status,
               ST_AsGeoJSON(p.geometry) AS GeoJson,
               NULL::text              AS NodeType,
               p.diameter_mm           AS DiameterMm,
               p.material              AS Material,
               p.length_m              AS LengthM,
               p.from_node_id          AS FromNodeId,
               p.to_node_id            AS ToNodeId,
               NULL::text              AS DeviceType,
               NULL::text              AS HostPipeId,
               NULL::text              AS HostNodeId,
               s.lifecycle_status      AS LifecycleStatus
        FROM network_pipes p
        LEFT JOIN network_asset_states s ON s.asset_id = p.id AND s.tenant_id = @tenantId
        WHERE p.tenant_id = @tenantId AND p.deleted_at IS NULL
          AND p.geometry && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;

    private const string DeviceSelect = """
        SELECT 'Device'                AS Kind,
               d.id                    AS Id,
               d.asset_code            AS AssetCode,
               d.status                AS Status,
               ST_AsGeoJSON(d.location) AS GeoJson,
               NULL::text              AS NodeType,
               NULL::int               AS DiameterMm,
               NULL::text              AS Material,
               NULL::double precision  AS LengthM,
               NULL::text              AS FromNodeId,
               NULL::text              AS ToNodeId,
               d.device_type           AS DeviceType,
               d.host_pipe_id          AS HostPipeId,
               d.host_node_id          AS HostNodeId,
               s.lifecycle_status      AS LifecycleStatus
        FROM network_devices d
        LEFT JOIN network_asset_states s ON s.asset_id = d.id AND s.tenant_id = @tenantId
        WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
          AND d.location && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;
}
