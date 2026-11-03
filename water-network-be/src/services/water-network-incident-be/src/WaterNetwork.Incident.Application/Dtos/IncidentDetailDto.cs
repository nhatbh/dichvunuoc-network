namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IncidentDetailDto(
    string Id, string TenantId, string Category, int Severity,
    double? Longitude, double? Latitude, string Status, string ReportedBy,
    string? CancellationReason, DateTime CreatedAt, DateTime UpdatedAt,
    IReadOnlyList<AffectedAssetDto> AffectedRefs,
    IReadOnlyList<TimelineEntryDto> Timeline,
    IReadOnlyList<IsolationPlanDto> IsolationPlans);
