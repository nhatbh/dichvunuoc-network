using NetTopologySuite.Geometries;

namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DraftNetworkAssetPersistenceModel
{
    public string Id { get; set; } = default!;
    public string RevisionId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string DraftKind { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string? ClientRef { get; set; }
    public Geometry Geometry { get; set; } = default!;
    public string AttributesJson { get; set; } = "{}";
    public string? FromRef { get; set; }
    public string? ToRef { get; set; }
    public string? HostRef { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
