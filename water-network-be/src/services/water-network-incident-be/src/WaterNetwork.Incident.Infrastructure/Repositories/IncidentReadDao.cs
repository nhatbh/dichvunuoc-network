using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Infrastructure.Persistence;

namespace WaterNetwork.Incident.Infrastructure.Repositories;

public sealed class IncidentReadDao(IncidentDbContext dbContext) : IIncidentReadDao
{
    public async Task<IReadOnlyList<IncidentSummaryDto>> ListAsync(
        string tenantId, string? status, int? severity, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id AS Id, category AS Category, severity AS Severity, status AS Status,
                   reported_by AS ReportedBy, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM network_incidents
            WHERE tenant_id = @tenantId
              AND (@status IS NULL OR status = @status)
              AND (@severity IS NULL OR severity = @severity)
            ORDER BY created_at DESC
            LIMIT 500
            """;
        var connection = dbContext.Database.GetDbConnection();
        var rows = await connection.QueryAsync<IncidentSummaryDto>(
            new CommandDefinition(sql, new { tenantId, status, severity }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IncidentDetailDto?> GetDetailAsync(string tenantId, string incidentId, CancellationToken ct = default)
    {
        const string incidentSql = """
            SELECT id AS Id, tenant_id AS TenantId, category AS Category, severity AS Severity,
                   longitude AS Longitude, latitude AS Latitude, status AS Status, reported_by AS ReportedBy,
                   cancellation_reason AS CancellationReason, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM network_incidents
            WHERE id = @incidentId AND tenant_id = @tenantId
            """;
        const string refsSql = """
            SELECT asset_id AS AssetId, kind AS Kind, verified AS Verified
            FROM incident_affected_assets
            WHERE incident_id = @incidentId AND tenant_id = @tenantId
            """;
        const string timelineSql = """
            SELECT entry_type AS EntryType, actor_id AS ActorId, note AS Note,
                   occurred_at AS OccurredAt, sequence AS Sequence
            FROM incident_timeline_entries
            WHERE incident_id = @incidentId AND tenant_id = @tenantId
            ORDER BY sequence
            """;
        const string plansSql = """
            SELECT id AS Id, status AS Status, start_node_id AS StartNodeId, graph_version AS GraphVersion,
                   valves_to_close AS ValvesToClose, isolated_nodes AS IsolatedNodes, isolated_pipes AS IsolatedPipes,
                   failure_reason AS FailureReason, computed_at AS ComputedAt, sequence AS Sequence
            FROM isolation_plans
            WHERE incident_id = @incidentId AND tenant_id = @tenantId
            ORDER BY sequence
            """;

        var connection = dbContext.Database.GetDbConnection();
        var args = new { incidentId, tenantId };

        var head = await connection.QuerySingleOrDefaultAsync<IncidentHeadRow>(
            new CommandDefinition(incidentSql, args, cancellationToken: ct));
        if (head is null) return null;

        var refs = (await connection.QueryAsync<AffectedAssetDto>(
            new CommandDefinition(refsSql, args, cancellationToken: ct))).ToList();
        var timeline = (await connection.QueryAsync<TimelineEntryDto>(
            new CommandDefinition(timelineSql, args, cancellationToken: ct))).ToList();
        var plans = (await connection.QueryAsync<IsolationPlanRow>(
            new CommandDefinition(plansSql, args, cancellationToken: ct)))
            .Select(p => new IsolationPlanDto(
                p.Id, p.Status, p.StartNodeId, p.GraphVersion,
                p.ValvesToClose, p.IsolatedNodes, p.IsolatedPipes,
                p.FailureReason, p.ComputedAt, p.Sequence))
            .ToList();

        return new IncidentDetailDto(
            head.Id, head.TenantId, head.Category, head.Severity, head.Longitude, head.Latitude,
            head.Status, head.ReportedBy, head.CancellationReason, head.CreatedAt, head.UpdatedAt, refs, timeline, plans);
    }

    private sealed record IncidentHeadRow(
        string Id, string TenantId, string Category, int Severity, double? Longitude, double? Latitude,
        string Status, string ReportedBy, string? CancellationReason, DateTime CreatedAt, DateTime UpdatedAt);

    // Mutable row mapped by Dapper's property-setter path: Npgsql surfaces a text[] column's field type as
    // System.Array, which Dapper's constructor matcher rejects against string[]/IReadOnlyList<string>
    // parameters. Property setters assign the string[] value directly, so arrays bind cleanly here; we then
    // project into the immutable IsolationPlanDto.
    private sealed class IsolationPlanRow
    {
        public string Id { get; set; } = default!;
        public string Status { get; set; } = default!;
        public string StartNodeId { get; set; } = default!;
        public long GraphVersion { get; set; }
        public string[] ValvesToClose { get; set; } = [];
        public string[] IsolatedNodes { get; set; } = [];
        public string[] IsolatedPipes { get; set; } = [];
        public string? FailureReason { get; set; }
        public DateTime ComputedAt { get; set; }
        public int Sequence { get; set; }
    }
}
