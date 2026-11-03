namespace WaterNetwork.Gis.Application.Ports;

public interface IAssetStateProjectionStore
{
    /// <summary>
    /// Upserts the lifecycle status of an asset. Guarded by <paramref name="occurredAt"/>:
    /// an event older than the stored row is ignored, so reordered deliveries never regress status.
    /// </summary>
    Task UpsertAsync(string assetId, string tenantId, string lifecycleStatus,
        DateTime occurredAt, string lastEventId, CancellationToken ct = default);
}
