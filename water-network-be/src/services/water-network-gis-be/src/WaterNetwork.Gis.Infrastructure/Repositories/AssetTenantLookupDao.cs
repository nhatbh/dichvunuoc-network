using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class AssetTenantLookupDao(GisDbContext dbContext) : IAssetTenantLookupDao
{
    public async Task<string?> GetTenantAsync(string assetId, string assetKind, CancellationToken ct = default)
    {
        // Table name is whitelisted from a closed set — never interpolated from external input.
        var table = assetKind switch
        {
            "Node" => "network_nodes",
            "Pipe" => "network_pipes",
            "Device" => "network_devices",
            _ => throw new ArgumentOutOfRangeException(nameof(assetKind), assetKind, "Unknown asset kind.")
        };
        var sql = $"SELECT tenant_id FROM {table} WHERE id = @assetId";
        var connection = dbContext.Database.GetDbConnection();
        return await connection.ExecuteScalarAsync<string?>(
            new CommandDefinition(sql, new { assetId }, cancellationToken: ct));
    }
}
