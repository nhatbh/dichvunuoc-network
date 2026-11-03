using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record DeviceDeletedData(
    string TenantId,
    string AssetCode,
    string DeviceType);

public sealed record DeviceDeleted(
    string AggregateId,
    DeviceDeletedData Data)
    : DomainEventBase<DeviceDeletedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkDevice",
        eventType: "DeviceDeleted",
        data: Data);
