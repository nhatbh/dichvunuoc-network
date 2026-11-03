using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentClassifiedData(
    string TenantId,
    string Category,
    int Severity,
    string ActorId,
    string? Note);

public sealed record IncidentClassified(string AggregateId, IncidentClassifiedData Data)
    : DomainEventBase<IncidentClassifiedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentClassified",
        data: Data);
