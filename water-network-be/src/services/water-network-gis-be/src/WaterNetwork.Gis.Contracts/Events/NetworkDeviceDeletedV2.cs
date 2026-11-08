namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkDeviceDeletedV2(
    string DeviceId,
    string TenantId,
    string AssetCode,
    string ComponentCode);
