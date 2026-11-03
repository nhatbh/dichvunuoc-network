using System.Text.Json;
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Asset.Application.Dtos;
using WaterNetwork.Asset.Application.Ports;
using WaterNetwork.Asset.Infrastructure.Persistence;

namespace WaterNetwork.Asset.Infrastructure.Repositories;

public sealed class AssetReadDao(AssetDbContext dbContext) : IAssetReadDao
{
    public async Task<AssetDetailDto?> GetDetailAsync(string tenantId, string assetId, CancellationToken ct = default)
    {
        const string assetSql = """
            SELECT a.id            AS Id,
                   a.tenant_id    AS TenantId,
                   a.asset_type   AS AssetType,
                   a.asset_code   AS AssetCode,
                   a.status       AS Status,
                   a.created_at   AS CreatedAt,
                   a.updated_at   AS UpdatedAt,
                   p.installation_year AS InstallationYear,
                   p.manufacturer      AS Manufacturer,
                   p.model             AS Model,
                   p.attributes        AS AttributesJson
            FROM network_assets a
            LEFT JOIN asset_technical_profiles p ON p.asset_id = a.id
            WHERE a.id = @assetId AND a.tenant_id = @tenantId
            """;

        const string lifecycleSql = """
            SELECT from_status AS FromStatus,
                   to_status   AS ToStatus,
                   actor_id    AS ActorId,
                   reason      AS Reason,
                   occurred_at AS OccurredAt
            FROM asset_lifecycle_entries
            WHERE asset_id = @assetId
            ORDER BY occurred_at, id
            """;

        var connection = dbContext.Database.GetDbConnection();

        var row = await connection.QuerySingleOrDefaultAsync<AssetDetailRow>(
            new CommandDefinition(assetSql, new { assetId, tenantId }, cancellationToken: ct));

        if (row is null)
            return null;

        var entries = (await connection.QueryAsync<AssetLifecycleEntryDto>(
            new CommandDefinition(lifecycleSql, new { assetId }, cancellationToken: ct))).ToList();

        AssetTechnicalProfileDto? profile = null;
        if (row.InstallationYear.HasValue || row.Manufacturer is not null || row.Model is not null || row.AttributesJson is not null)
        {
            var attrs = row.AttributesJson is not null
                ? JsonSerializer.Deserialize<Dictionary<string, string?>>(row.AttributesJson) ?? new Dictionary<string, string?>()
                : new Dictionary<string, string?>();
            profile = new AssetTechnicalProfileDto(row.InstallationYear, row.Manufacturer, row.Model, attrs);
        }

        return new AssetDetailDto(
            row.Id, row.TenantId, row.AssetType, row.AssetCode, row.Status,
            row.CreatedAt, row.UpdatedAt, profile, entries);
    }

    public async Task<AssetPagedResult> GetPagedAsync(
        string tenantId, string? type, string? status, int page, int pageSize, CancellationToken ct = default)
    {
        var skip = (page - 1) * pageSize;

        var whereClauses = new List<string> { "tenant_id = @tenantId" };
        if (type is not null) whereClauses.Add("asset_type = @type");
        if (status is not null) whereClauses.Add("status = @status");
        var where = string.Join(" AND ", whereClauses);

        var dataSql = $"""
            SELECT id          AS Id,
                   asset_type  AS AssetType,
                   asset_code  AS AssetCode,
                   status      AS Status,
                   updated_at  AS UpdatedAt
            FROM network_assets
            WHERE {where}
            ORDER BY updated_at DESC
            LIMIT @take OFFSET @skip
            """;

        var countSql = $"SELECT COUNT(*) FROM network_assets WHERE {where}";

        var connection = dbContext.Database.GetDbConnection();
        var parameters = new { tenantId, type, status, take = pageSize, skip };

        var data = (await connection.QueryAsync<AssetSummaryDto>(
            new CommandDefinition(dataSql, parameters, cancellationToken: ct))).ToList();
        var total = await connection.ExecuteScalarAsync<long>(
            new CommandDefinition(countSql, parameters, cancellationToken: ct));

        return new AssetPagedResult(data, page, pageSize, total);
    }

    // Flat projection row for the detail query join
    private sealed class AssetDetailRow
    {
        public string Id { get; set; } = default!;
        public string TenantId { get; set; } = default!;
        public string AssetType { get; set; } = default!;
        public string AssetCode { get; set; } = default!;
        public string Status { get; set; } = default!;
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        // Profile (nullable — LEFT JOIN)
        public int? InstallationYear { get; set; }
        public string? Manufacturer { get; set; }
        public string? Model { get; set; }
        public string? AttributesJson { get; set; }
    }
}
