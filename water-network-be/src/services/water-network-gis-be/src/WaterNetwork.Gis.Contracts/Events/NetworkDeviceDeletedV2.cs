namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkDeviceDeletedV1(
    string DeviceId,
    string TenantId,
    string AssetCode,
    string DeviceType);
