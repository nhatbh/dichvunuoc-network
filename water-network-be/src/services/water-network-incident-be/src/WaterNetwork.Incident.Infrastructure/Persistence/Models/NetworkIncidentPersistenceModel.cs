namespace WaterNetwork.Incident.Infrastructure.Persistence.Models;

public sealed class NetworkIncidentPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string Category { get; set; } = default!;
    public int Severity { get; set; }
    public double? Longitude { get; set; }
    public double? Latitude { get; set; }
    public NetTopologySuite.Geometries.Point? Location { get; set; }
    public string Status { get; set; } = default!;
    public string ReportedBy { get; set; } = default!;
    public string? CancellationReason { get; set; }
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<IncidentAffectedAssetModel> AffectedAssets { get; set; } = [];
    public List<IncidentTimelineEntryModel> TimelineEntries { get; set; } = [];
    public List<IsolationPlanModel> IsolationPlans { get; set; } = [];
}
