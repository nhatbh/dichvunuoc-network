namespace WaterNetwork.Gis.Application.Dtos;

public sealed record DeviceDetailDto(
    string Id,
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude,
    string Status,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);
