using WaterPlatform.BuildingBlocks.Domain.Events;
namespace WaterNetwork.Gis.Domain.DomainEvents;
public sealed record NetworkAssetEditedData(string TenantId, string Kind, string AssetCode, int Version);
public sealed record NetworkAssetEdited(string AggregateId, NetworkAssetEditedData Data)
    : DomainEventBase<NetworkAssetEditedData>(AggregateId, "Network" + Data.Kind, "NetworkAssetEdited", Data);
