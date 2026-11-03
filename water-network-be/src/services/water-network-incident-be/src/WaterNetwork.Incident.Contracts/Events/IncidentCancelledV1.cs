namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.cancelled</c>.</summary>
public sealed record IncidentCancelledV1(
    string IncidentId,
    string TenantId,
    string Reason,
    string CancelledBy);
