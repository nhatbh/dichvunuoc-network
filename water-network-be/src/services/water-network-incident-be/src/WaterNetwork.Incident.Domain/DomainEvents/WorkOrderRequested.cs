using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record WorkOrderRequestedData(
    IReadOnlyList<IncidentAssetRefData> AssetRefs,
    string Summary,
    int Severity);

public sealed record WorkOrderRequested(string AggregateId, WorkOrderRequestedData Data)
    : DomainEventBase<WorkOrderRequestedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "WorkOrderRequested",
        data: Data);
