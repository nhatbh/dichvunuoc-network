using NetTopologySuite.Geometries;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class NetworkPipePersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string FromNodeId { get; set; } = default!;
    public string ToNodeId { get; set; } = default!;
    public LineString Geometry { get; set; } = default!;
    public int DiameterMm { get; set; }
    public string Material { get; set; } = default!;
    public double LengthM { get; set; }
    public string? LengthValidationWarning { get; set; }
    public string Status { get; set; } = "Active";
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}
