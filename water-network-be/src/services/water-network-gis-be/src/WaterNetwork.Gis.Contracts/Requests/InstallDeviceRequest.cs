namespace WaterNetwork.Gis.Contracts.Requests;

public sealed record InstallDeviceRequest(
    string AssetCode,
    string ComponentCode,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude,
    IReadOnlyDictionary<string, string>? Properties = null);
