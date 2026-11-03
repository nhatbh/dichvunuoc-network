namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class NetworkAssetPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetType { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string Status { get; set; } = default!;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<AssetLifecycleEntryPersistenceModel> LifecycleEntries { get; set; } = [];
    public string? DecommissionReason { get; set; }
    public string? DecommissionedBy { get; set; }
    public AssetTechnicalProfilePersistenceModel? TechnicalProfile { get; set; }
}
