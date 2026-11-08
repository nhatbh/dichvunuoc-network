namespace WaterNetwork.Gis.Application.Dtos;

public sealed record NodeDetailDto(
    string Id, string AssetCode, string ComponentCode,
    double Latitude, double Longitude, int Version, DateTime CreatedAt, DateTime UpdatedAt,
    IReadOnlyDictionary<string, string> Properties);
