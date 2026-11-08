using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetRegisteredData(
    string TenantId,
    string AssetType,
    string AssetCode,
    string Status,
    string ComponentCode);

public sealed record AssetRegistered(
    string AggregateId,
    AssetRegisteredData Data)
    : DomainEventBase<AssetRegisteredData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkAsset",
        eventType: "AssetRegistered",
        data: Data);
