namespace WaterNetwork.Gis.Application.Dtos;

public sealed record NodeDetailDto(
    string Id, string AssetCode, string NodeType,
    double Latitude, double Longitude, int Version, DateTime CreatedAt, DateTime UpdatedAt);
