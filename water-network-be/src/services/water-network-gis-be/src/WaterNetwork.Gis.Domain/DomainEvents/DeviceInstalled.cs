using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record DeviceInstalledData(
    string TenantId,
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude);

public sealed record DeviceInstalled(
    string AggregateId,
    DeviceInstalledData Data)
    : DomainEventBase<DeviceInstalledData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkDevice",
        eventType: "DeviceInstalled",
        data: Data);
