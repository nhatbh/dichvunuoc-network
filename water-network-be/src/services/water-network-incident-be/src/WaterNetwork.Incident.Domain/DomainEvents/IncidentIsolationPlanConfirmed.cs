using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentIsolationPlanConfirmedData(
    string TenantId,
    string PlanId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    IReadOnlyList<IncidentAssetRefData> AffectedRefs,
    string ConfirmedBy);

public sealed record IncidentIsolationPlanConfirmed(string AggregateId, IncidentIsolationPlanConfirmedData Data)
    : DomainEventBase<IncidentIsolationPlanConfirmedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentIsolationPlanConfirmed",
        data: Data);
