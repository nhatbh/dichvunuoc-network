using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class NodeReadDao(GisDbContext dbContext) : INodeReadDao
{
    public async Task<NodeDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id AS Id, asset_code AS AssetCode, node_type AS NodeType,
                   ST_Y(location) AS Latitude, ST_X(location) AS Longitude,
                   version, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM network_nodes
            WHERE id = @id AND tenant_id = @tenantId AND deleted_at IS NULL
            """;
        var connection = dbContext.Database.GetDbConnection();
        return await connection.QuerySingleOrDefaultAsync<NodeDetailDto>(
            new CommandDefinition(sql, new { id, tenantId }, cancellationToken: ct));
    }
}
