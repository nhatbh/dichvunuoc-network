// DraftNetworkAsset.cs
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Design.Domain.Entities;

/// <summary>A draft asset belonging to a DesignRevision. Plain entity (no domain events —
/// high-churn during import); persisted via IDraftNetworkAssetRepository.</summary>
public sealed class DraftNetworkAsset : Entity
{
    public string RevisionId { get; private set; }
    public string TenantId { get; private set; }
    public DraftAssetKind Kind { get; private set; }
    public string AssetCode { get; private set; }
    public string? ClientRef { get; private set; }
    public DraftGeometry Geometry { get; private set; }
    public IReadOnlyDictionary<string, string> Attributes { get; private set; }
    public string? FromRef { get; private set; }
    public string? ToRef { get; private set; }
    public string? HostRef { get; private set; }

    private DraftNetworkAsset(
        string id, string revisionId, string tenantId, DraftAssetKind kind, string assetCode,
        string? clientRef, DraftGeometry geometry, IReadOnlyDictionary<string, string> attributes,
        string? fromRef, string? toRef, string? hostRef,
        DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, createdAt, updatedAt)
    {
        RevisionId = revisionId;
        TenantId = tenantId;
        Kind = kind;
        AssetCode = assetCode;
        ClientRef = clientRef;
        Geometry = geometry;
        Attributes = attributes;
        FromRef = fromRef;
        ToRef = toRef;
        HostRef = hostRef;
    }

    public static DraftNetworkAsset Create(
        string revisionId, string tenantId, DraftAssetKind kind, string assetCode, string? clientRef,
        DraftGeometry geometry, IReadOnlyDictionary<string, string> attributes,
        string? fromRef, string? toRef, string? hostRef)
        => new(Guid.CreateVersion7().ToString(), revisionId, tenantId, kind, assetCode, clientRef,
            geometry, attributes, fromRef, toRef, hostRef);

    public void UpdateGeometry(DraftGeometry geometry)
    {
        Geometry = geometry;
        UpdatedAt = DateTime.UtcNow;
    }

    public static DraftNetworkAsset Reconstitute(
        string id, string revisionId, string tenantId, DraftAssetKind kind, string assetCode,
        string? clientRef, DraftGeometry geometry, IReadOnlyDictionary<string, string> attributes,
        string? fromRef, string? toRef, string? hostRef, DateTime createdAt, DateTime updatedAt)
        => new(id, revisionId, tenantId, kind, assetCode, clientRef, geometry, attributes,
            fromRef, toRef, hostRef, createdAt, updatedAt);
}
