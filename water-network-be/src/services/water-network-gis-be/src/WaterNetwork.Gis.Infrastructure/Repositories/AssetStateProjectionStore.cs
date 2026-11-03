using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Dapper upsert into network_asset_states with an OccurredAt ordering guard: the WHERE clause on
/// the ON CONFLICT branch drops the write when the incoming event is older than the stored row,
/// so at-least-once redelivery and event reordering never regress lifecycle status.
/// </summary>
public sealed class AssetStateProjectionStore(GisDbContext dbContext) : IAssetStateProjectionStore
{
    private const string UpsertSql = """
        INSERT INTO network_asset_states (asset_id, tenant_id, lifecycle_status, updated_at, last_event_id)
        VALUES (@assetId, @tenantId, @lifecycleStatus, @updatedAt, @lastEventId)
        ON CONFLICT (asset_id) DO UPDATE
          SET lifecycle_status = excluded.lifecycle_status,
              updated_at       = excluded.updated_at,
              last_event_id    = excluded.last_event_id
          WHERE excluded.updated_at >= network_asset_states.updated_at;
        """;

    public async Task UpsertAsync(string assetId, string tenantId, string lifecycleStatus,
        DateTime occurredAt, string lastEventId, CancellationToken ct = default)
    {
        var connection = dbContext.Database.GetDbConnection();
        await connection.ExecuteAsync(new CommandDefinition(UpsertSql, new
        {
            assetId,
            tenantId,
            lifecycleStatus,
            updatedAt = occurredAt,
            lastEventId
        }, cancellationToken: ct));
    }
}
