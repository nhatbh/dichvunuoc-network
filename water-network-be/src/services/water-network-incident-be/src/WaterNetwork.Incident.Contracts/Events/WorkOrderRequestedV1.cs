namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>maintenance.work-order-requested</c> — Phase 3→4 contract (INC-3, decision 0024). FROZEN: do not add fields.</summary>
public sealed record WorkOrderRequestedV1(
    string IncidentId,
    IReadOnlyList<IncidentAssetRefV1> AssetRefs,
    string Summary,
    int Severity);
