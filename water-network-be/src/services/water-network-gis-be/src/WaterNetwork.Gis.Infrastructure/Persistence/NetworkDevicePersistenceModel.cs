using NetTopologySuite.Geometries;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class NetworkDevicePersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string DeviceType { get; set; } = default!;
    public string? HostPipeId { get; set; }
    public string? HostNodeId { get; set; }
    public Point Location { get; set; } = default!;
    public string Status { get; set; } = "Active";
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}
