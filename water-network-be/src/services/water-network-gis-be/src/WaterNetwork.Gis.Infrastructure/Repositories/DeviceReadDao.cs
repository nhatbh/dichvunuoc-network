using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class DeviceReadDao(GisDbContext dbContext) : IDeviceReadDao
{
    private sealed record DeviceRow(
        string Id, string AssetCode, string ComponentCode, string? HostPipeId, string? HostNodeId,
        double Latitude, double Longitude, string Status, int Version,
        DateTime CreatedAt, DateTime UpdatedAt, string PropertiesJson);

    public async Task<DeviceDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id               AS Id,
                   asset_code       AS AssetCode,
                   component_code   AS ComponentCode,
                   host_pipe_id     AS HostPipeId,
                   host_node_id     AS HostNodeId,
                   ST_Y(location)   AS Latitude,
                   ST_X(location)   AS Longitude,
                   status           AS Status,
                   version          AS Version,
                   created_at       AS CreatedAt,
                   updated_at       AS UpdatedAt,
                   properties::text AS PropertiesJson
            FROM network_devices
            WHERE id = @id AND tenant_id = @tenantId AND deleted_at IS NULL
            """;

        var connection = dbContext.Database.GetDbConnection();
        var row = await connection.QuerySingleOrDefaultAsync<DeviceRow>(
            new CommandDefinition(sql, new { id, tenantId }, cancellationToken: ct));
        return row is null
            ? null
            : new DeviceDetailDto(
                row.Id, row.AssetCode, row.ComponentCode, row.HostPipeId, row.HostNodeId,
                row.Latitude, row.Longitude, row.Status, row.Version, row.CreatedAt, row.UpdatedAt,
                PropertiesJson.Read(row.PropertiesJson));
    }
}
