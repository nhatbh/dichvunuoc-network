namespace WaterNetwork.Gis.Infrastructure.Persistence;

/// <summary>
/// Local read-model row: lifecycle status of an asset (owned by asset-be) projected into GIS.
/// asset_id == GIS asset id (decision #2). No soft-delete, no aggregate — pure projection.
/// </summary>
public sealed class AssetStatePersistenceModel
{
    public string AssetId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string LifecycleStatus { get; set; } = default!;
    public DateTime UpdatedAt { get; set; }
    public string LastEventId { get; set; } = default!;
}
