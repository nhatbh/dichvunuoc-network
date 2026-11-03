using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentResolvedData(
    string TenantId,
    string ResolvedBy,
    string? ResolutionNote);

public sealed record IncidentResolved(string AggregateId, IncidentResolvedData Data)
    : DomainEventBase<IncidentResolvedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentResolved",
        data: Data);
