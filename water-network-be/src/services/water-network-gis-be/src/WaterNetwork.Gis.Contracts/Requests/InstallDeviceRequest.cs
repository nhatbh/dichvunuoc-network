namespace WaterNetwork.Gis.Contracts.Requests;

public sealed record InstallDeviceRequest(
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude);
