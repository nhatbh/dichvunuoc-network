namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.resolved</c> (INC-3, decision 0024).</summary>
public sealed record IncidentResolvedV1(
    string IncidentId,
    string TenantId,
    string ResolvedBy,
    string? ResolutionNote);
