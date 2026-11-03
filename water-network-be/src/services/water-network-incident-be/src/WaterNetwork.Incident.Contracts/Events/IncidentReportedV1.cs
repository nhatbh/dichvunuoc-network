namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.reported</c>.</summary>
public sealed record IncidentReportedV1(
    string IncidentId,
    string TenantId,
    string Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<AffectedAssetRefV1> AffectedRefs,
    string ReportedBy);
