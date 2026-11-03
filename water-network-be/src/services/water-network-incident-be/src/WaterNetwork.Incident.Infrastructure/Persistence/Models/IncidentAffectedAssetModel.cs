namespace WaterNetwork.Incident.Infrastructure.Persistence.Models;

public sealed class IncidentAffectedAssetModel
{
    public string Id { get; set; } = default!;
    public string IncidentId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetId { get; set; } = default!;
    public string Kind { get; set; } = default!;
    public bool Verified { get; set; }
}
