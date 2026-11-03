using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetStatusChangedData(
    string AssetType, string PreviousStatus, string NewStatus, string? Reason, string ChangedBy);

public sealed record AssetStatusChanged(string AggregateId, AssetStatusChangedData Data)
    : DomainEventBase<AssetStatusChangedData>(
        aggregateId: AggregateId, aggregateType: "NetworkAsset", eventType: "AssetStatusChanged", data: Data);
