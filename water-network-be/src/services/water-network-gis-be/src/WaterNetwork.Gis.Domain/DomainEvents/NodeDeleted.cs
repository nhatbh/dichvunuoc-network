using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record NodeDeletedData(
    string TenantId,
    string AssetCode,
    string NodeType);

public sealed record NodeDeleted(
    string AggregateId,
    NodeDeletedData Data)
    : DomainEventBase<NodeDeletedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkNode",
        eventType: "NodeDeleted",
        data: Data);
