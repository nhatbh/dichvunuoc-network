namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.classified</c>.</summary>
public sealed record IncidentClassifiedV1(
    string IncidentId,
    string TenantId,
    string Category,
    int Severity,
    string ClassifiedBy,
    string? Note);
