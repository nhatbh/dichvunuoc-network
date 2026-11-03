namespace WaterNetwork.Gis.Application.Dtos;

public sealed record GeometryVersionDto(
    int Version,
    string GeoJson,
    string? ChangedBy,
    string? Reason,
    DateTime ChangedAt);
