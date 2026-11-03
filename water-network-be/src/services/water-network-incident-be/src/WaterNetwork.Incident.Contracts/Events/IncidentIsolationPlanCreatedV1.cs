namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.isolation-plan-created</c> (decision 0023).</summary>
public sealed record IncidentIsolationPlanCreatedV1(
    string IncidentId,
    string TenantId,
    string PlanId,
    string StartNodeId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    string ComputedBy);
