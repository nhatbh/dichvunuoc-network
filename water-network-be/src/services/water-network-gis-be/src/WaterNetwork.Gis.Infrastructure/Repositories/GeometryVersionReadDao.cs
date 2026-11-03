using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class GeometryVersionReadDao(GisDbContext dbContext) : IGeometryVersionReadDao
{
    public async Task<IReadOnlyList<GeometryVersionDto>> ListByAssetAsync(string assetId, CancellationToken ct = default)
    {
        // geometry_versions has no tenant_id column; tenant isolation is inherited from
        // asset_id uniqueness (node-<uuid7> values are globally unique) — do not add a spurious tenant filter.
        const string sql = """
            SELECT version     AS Version,
                   geojson     AS GeoJson,
                   changed_by  AS ChangedBy,
                   reason      AS Reason,
                   changed_at  AS ChangedAt
            FROM geometry_versions
            WHERE asset_id = @assetId
            ORDER BY version DESC
            """;

        var connection = dbContext.Database.GetDbConnection();
        var rows = await connection.QueryAsync<GeometryVersionDto>(
            new CommandDefinition(sql, new { assetId }, cancellationToken: ct));
        return rows.ToList();
    }
}
