namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.isolation-plan-confirmed</c> (INC-3, decision 0024).</summary>
public sealed record IncidentIsolationPlanConfirmedV1(
    string IncidentId,
    string TenantId,
    string PlanId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    IReadOnlyList<IncidentAssetRefV1> AffectedRefs,
    string ConfirmedBy);
