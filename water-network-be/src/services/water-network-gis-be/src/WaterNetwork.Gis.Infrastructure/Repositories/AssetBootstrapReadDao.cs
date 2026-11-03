using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Produces the tenant bootstrap aggregate with a single Dapper command. QueryMultiple
/// keeps summary, material and status result sets strongly typed without serialising
/// nested JSON in PostgreSQL.
/// </summary>
public sealed class AssetBootstrapReadDao(GisDbContext dbContext) : IAssetBootstrapReadDao
{
    public async Task<AssetBootstrapSnapshot> QueryAsync(string tenantId, CancellationToken ct = default)
    {
        var connection = dbContext.Database.GetDbConnection();
        using var result = await connection.QueryMultipleAsync(
            new CommandDefinition(Sql, new { tenantId }, cancellationToken: ct));

        var summary = await result.ReadSingleAsync<BootstrapSummaryRow>();
        var materialMix = (await result.ReadAsync<AssetMaterialMixRow>()).AsList();
        var statusMix = (await result.ReadAsync<AssetStatusMixRow>()).AsList();

        return new AssetBootstrapSnapshot(
            summary.Nodes,
            summary.Pipes,
            summary.Devices,
            summary.PipeLengthM,
            summary.MinLon,
            summary.MinLat,
            summary.MaxLon,
            summary.MaxLat,
            materialMix,
            statusMix);
    }

    private sealed record BootstrapSummaryRow(
        long Nodes,
        long Pipes,
        long Devices,
        double PipeLengthM,
        double? MinLon,
        double? MinLat,
        double? MaxLon,
        double? MaxLat);

    private const string Sql = """
        WITH nodes AS (
            SELECT n.location AS geometry
            FROM network_nodes n
            WHERE n.tenant_id = @tenantId AND n.deleted_at IS NULL
        ),
        pipes AS (
            SELECT p.geometry, p.length_m
            FROM network_pipes p
            WHERE p.tenant_id = @tenantId AND p.deleted_at IS NULL
        ),
        devices AS (
            SELECT d.location AS geometry
            FROM network_devices d
            WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
        ),
        geometries AS (
            SELECT n.geometry FROM nodes n
            UNION ALL
            SELECT p.geometry FROM pipes p
            UNION ALL
            SELECT d.geometry FROM devices d
        )
        SELECT (SELECT COUNT(*) FROM nodes) AS Nodes,
               (SELECT COUNT(*) FROM pipes) AS Pipes,
               (SELECT COUNT(*) FROM devices) AS Devices,
               (SELECT COALESCE(SUM(p.length_m), 0)::double precision FROM pipes p) AS PipeLengthM,
               ST_XMin(extent.value) AS MinLon,
               ST_YMin(extent.value) AS MinLat,
               ST_XMax(extent.value) AS MaxLon,
               ST_YMax(extent.value) AS MaxLat
        FROM (SELECT ST_Extent(g.geometry) AS value FROM geometries g) extent;

        SELECT COALESCE(NULLIF(BTRIM(p.material), ''), 'Unknown') AS Material,
               COUNT(*) AS Count,
               COALESCE(SUM(p.length_m), 0)::double precision AS LengthM
        FROM network_pipes p
        WHERE p.tenant_id = @tenantId AND p.deleted_at IS NULL
        GROUP BY COALESCE(NULLIF(BTRIM(p.material), ''), 'Unknown')
        ORDER BY Material;

        SELECT COALESCE(NULLIF(BTRIM(p.status), ''), 'Unknown') AS Status,
               COUNT(*) AS Count
        FROM network_pipes p
        WHERE p.tenant_id = @tenantId AND p.deleted_at IS NULL
        GROUP BY COALESCE(NULLIF(BTRIM(p.status), ''), 'Unknown')
        ORDER BY Status;
        """;
}
