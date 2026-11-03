using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentCancelledData(
    string TenantId,
    string Reason,
    string ActorId);

public sealed record IncidentCancelled(string AggregateId, IncidentCancelledData Data)
    : DomainEventBase<IncidentCancelledData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentCancelled",
        data: Data);
