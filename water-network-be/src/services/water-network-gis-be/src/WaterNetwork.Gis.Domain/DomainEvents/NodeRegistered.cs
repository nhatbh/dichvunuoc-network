using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record NodeRegisteredData(
    string TenantId,
    string AssetCode,
    string NodeType,
    double Latitude,
    double Longitude);

public sealed record NodeRegistered(
    string AggregateId,
    NodeRegisteredData Data)
    : DomainEventBase<NodeRegisteredData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkNode",
        eventType: "NodeRegistered",
        data: Data);
