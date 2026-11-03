using NetTopologySuite.Geometries;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class GeometryVersionPersistenceModel
{
    public string Id { get; set; } = default!;
    public string AssetId { get; set; } = default!;
    public string AssetKind { get; set; } = default!;
    public int Version { get; set; }
    public Geometry? Geometry { get; set; }
    public string GeoJson { get; set; } = default!;
    public string? ChangedBy { get; set; }
    public string? Reason { get; set; }
    public DateTime ChangedAt { get; set; }
}
