namespace WaterNetwork.Gis.Application.Ports;

public interface IAssetTenantLookupDao
{
    /// <summary>
    /// Resolves the owning tenant of a GIS asset by its id and kind (Node|Pipe|Device).
    /// Returns null when no such asset row exists. Used by the lifecycle projection consumer because
    /// outbox-published envelopes carry no tenant and asset.status.changed has no tenant in its payload.
    /// </summary>
    Task<string?> GetTenantAsync(string assetId, string assetKind, CancellationToken ct = default);
}
