namespace WaterNetwork.Incident.Domain.ValueObjects;

/// <summary>A reference to a GIS asset affected by an incident. <see cref="Verified"/> is false
/// when GIS could not confirm the ref existed at report time (decision 0021 — advisory, not blocking).</summary>
public sealed record AssetRef
{
    public string AssetId { get; }
    public AssetRefKind Kind { get; }
    public bool Verified { get; }

    private AssetRef(string assetId, AssetRefKind kind, bool verified)
    {
        AssetId = assetId;
        Kind = kind;
        Verified = verified;
    }

    public static AssetRef Create(string assetId, AssetRefKind kind, bool verified)
    {
        if (string.IsNullOrWhiteSpace(assetId))
            throw new ArgumentException("Asset ref id is required.", nameof(assetId));
        return new AssetRef(assetId.Trim(), kind, verified);
    }
}
