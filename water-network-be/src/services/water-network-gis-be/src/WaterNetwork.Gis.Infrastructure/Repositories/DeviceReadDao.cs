using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class DeviceReadDao(GisDbContext dbContext) : IDeviceReadDao
{
    public async Task<DeviceDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id              AS Id,
                   asset_code      AS AssetCode,
                   device_type     AS DeviceType,
                   host_pipe_id    AS HostPipeId,
                   host_node_id    AS HostNodeId,
                   ST_Y(location)  AS Latitude,
                   ST_X(location)  AS Longitude,
                   status          AS Status,
                   version         AS Version,
                   created_at      AS CreatedAt,
                   updated_at      AS UpdatedAt
            FROM network_devices
            WHERE id = @id AND tenant_id = @tenantId AND deleted_at IS NULL
            """;

        var connection = dbContext.Database.GetDbConnection();
        return await connection.QuerySingleOrDefaultAsync<DeviceDetailDto>(
            new CommandDefinition(sql, new { id, tenantId }, cancellationToken: ct));
    }
}
