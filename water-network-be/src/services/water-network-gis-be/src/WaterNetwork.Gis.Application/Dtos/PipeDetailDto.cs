namespace WaterNetwork.Gis.Application.Dtos;

public sealed record GeoPointDto(double Lat, double Lng);

public sealed record PipeDetailDto(
    string Id,
    string AssetCode,
    string FromNodeId,
    string ToNodeId,
    IReadOnlyList<GeoPointDto> Points,
    double DiameterMm,
    string Material,
    double LengthM,
    string? LengthValidationWarning,
    string Status,
    int Version,
    DateTime CreatedAt,
    DateTime UpdatedAt);
