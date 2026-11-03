using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentIsolationPlanCreatedData(
    string TenantId,
    string PlanId,
    string StartNodeId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    string ComputedBy);

public sealed record IncidentIsolationPlanCreated(string AggregateId, IncidentIsolationPlanCreatedData Data)
    : DomainEventBase<IncidentIsolationPlanCreatedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentIsolationPlanCreated",
        data: Data);
