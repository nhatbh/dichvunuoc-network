using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record NodeRelocatedData(
    string TenantId,
    string AssetCode,
    double OldLatitude,
    double OldLongitude,
    double NewLatitude,
    double NewLongitude,
    string? Reason);

public sealed record NodeRelocated(string AggregateId, NodeRelocatedData Data)
    : DomainEventBase<NodeRelocatedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkNode",
        eventType: "NodeRelocated",
        data: Data);
