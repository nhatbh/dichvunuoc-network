using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Dapper keyset export across the three asset tables. Each branch projects into
/// the same flat row shape (NULL-filling type-specific columns), UNION ALL'd,
/// with a single global ORDER BY id + LIMIT. Keyset by <c>id &gt; @afterId</c>
/// (afterId defaults to empty string so the first page matches all). Returns the
/// minimal fields topology-rs needs to rebuild the network graph.
/// </summary>
public sealed class ExportAssetReadDao(GisDbContext dbContext) : IExportAssetReadDao
{
    private const string NodeSelect = """
        SELECT 'Node' AS Kind, n.id AS Id, n.asset_code AS AssetCode,
               n.node_type AS NodeType,
               NULL::text AS FromNodeId, NULL::text AS ToNodeId,
               NULL::int AS DiameterMm, NULL::text AS Material, NULL::double precision AS LengthM,
               NULL::text AS DeviceType, NULL::text AS HostPipeId, NULL::text AS HostNodeId
        FROM network_nodes n
        WHERE n.tenant_id = @tenantId AND n.deleted_at IS NULL AND n.id > @afterId
        """;

    private const string PipeSelect = """
        SELECT 'Pipe' AS Kind, p.id AS Id, p.asset_code AS AssetCode,
               NULL::text AS NodeType,
               p.from_node_id AS FromNodeId, p.to_node_id AS ToNodeId,
               p.diameter_mm AS DiameterMm, p.material AS Material, p.length_m AS LengthM,
               NULL::text AS DeviceType, NULL::text AS HostPipeId, NULL::text AS HostNodeId
        FROM network_pipes p
        WHERE p.tenant_id = @tenantId AND p.deleted_at IS NULL AND p.id > @afterId
        """;

    private const string DeviceSelect = """
        SELECT 'Device' AS Kind, d.id AS Id, d.asset_code AS AssetCode,
               NULL::text AS NodeType,
               NULL::text AS FromNodeId, NULL::text AS ToNodeId,
               NULL::int AS DiameterMm, NULL::text AS Material, NULL::double precision AS LengthM,
               d.device_type AS DeviceType, d.host_pipe_id AS HostPipeId, d.host_node_id AS HostNodeId
        FROM network_devices d
        WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL AND d.id > @afterId
        """;

    public async Task<IReadOnlyList<AssetExportItemDto>> QueryAsync(
        string tenantId, string? afterId, int fetchLimit, CancellationToken ct = default)
    {
        // ORDER BY id (the output column from each branch's `id AS Id` projection)
        // gives a single deterministic keyset order across the UNION ALL.
        var sql = string.Join("\nUNION ALL\n", [NodeSelect, PipeSelect, DeviceSelect])
                  + "\nORDER BY id\nLIMIT @fetchLimit";

        var parameters = new { tenantId, afterId = afterId ?? string.Empty, fetchLimit };
        var connection = dbContext.Database.GetDbConnection();
        var rows = await connection.QueryAsync<AssetExportItemDto>(
            new CommandDefinition(sql, parameters, cancellationToken: ct));
        return rows.AsList();
    }
}
