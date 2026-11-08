namespace WaterNetwork.Gis.Application.Dtos;

public sealed record DeviceDetailDto(
    string Id,
    string AssetCode,
    string ComponentCode,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude,
    string Status,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyDictionary<string, string> Properties);
