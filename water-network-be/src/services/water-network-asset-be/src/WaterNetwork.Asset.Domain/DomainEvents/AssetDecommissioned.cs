using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetDecommissionedData(string AssetType, string? Reason, string DecommissionedBy);

public sealed record AssetDecommissioned(string AggregateId, AssetDecommissionedData Data)
    : DomainEventBase<AssetDecommissionedData>(
        aggregateId: AggregateId, aggregateType: "NetworkAsset", eventType: "AssetDecommissioned", data: Data);
