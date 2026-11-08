using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class NodeReadDao(GisDbContext dbContext) : INodeReadDao
{
    private sealed record NodeRow(
        string Id, string AssetCode, string ComponentCode, double Latitude, double Longitude,
        int Version, DateTime CreatedAt, DateTime UpdatedAt, string PropertiesJson);

    public async Task<NodeDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id AS Id, asset_code AS AssetCode, component_code AS ComponentCode,
                   ST_Y(location) AS Latitude, ST_X(location) AS Longitude,
                   version AS Version, created_at AS CreatedAt, updated_at AS UpdatedAt,
                   properties::text AS PropertiesJson
            FROM network_nodes
            WHERE id = @id AND tenant_id = @tenantId AND deleted_at IS NULL
            """;
        var connection = dbContext.Database.GetDbConnection();
        var row = await connection.QuerySingleOrDefaultAsync<NodeRow>(
            new CommandDefinition(sql, new { id, tenantId }, cancellationToken: ct));
        return row is null
            ? null
            : new NodeDetailDto(
                row.Id, row.AssetCode, row.ComponentCode, row.Latitude, row.Longitude,
                row.Version, row.CreatedAt, row.UpdatedAt, PropertiesJson.Read(row.PropertiesJson));
    }
}
