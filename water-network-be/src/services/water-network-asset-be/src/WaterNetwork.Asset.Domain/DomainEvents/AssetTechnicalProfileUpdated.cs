using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetTechnicalProfileUpdatedData(
    string AssetType, int? InstallationYear, string? Manufacturer, string? Model);

public sealed record AssetTechnicalProfileUpdated(string AggregateId, AssetTechnicalProfileUpdatedData Data)
    : DomainEventBase<AssetTechnicalProfileUpdatedData>(
        aggregateId: AggregateId, aggregateType: "NetworkAsset",
        eventType: "AssetTechnicalProfileUpdated", data: Data);
