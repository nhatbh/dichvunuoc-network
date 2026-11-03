using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Domain.Entities;

/// <summary>Append-only audit row for one geometry state of an asset. Never updated or deleted.</summary>
public sealed class GeometryVersion
{
    public string Id { get; }
    public string AssetId { get; }
    public AssetKind AssetKind { get; }
    public int Version { get; }
    public string GeoJson { get; }
    public string? ChangedBy { get; }
    public string? Reason { get; }
    public DateTime ChangedAt { get; }

    private GeometryVersion(string id, string assetId, AssetKind assetKind, int version,
        string geoJson, string? changedBy, string? reason, DateTime changedAt)
    {
        Id = id;
        AssetId = assetId;
        AssetKind = assetKind;
        Version = version;
        GeoJson = geoJson;
        ChangedBy = changedBy;
        Reason = reason;
        ChangedAt = changedAt;
    }

    public static GeometryVersion Create(string assetId, AssetKind assetKind, int version,
        string geoJson, string? changedBy = null, string? reason = null)
    {
        if (string.IsNullOrWhiteSpace(assetId))
            throw new DomainException("GeometryVersion.InvalidAssetId", "AssetId is required.");
        if (version < 1)
            throw new DomainException("GeometryVersion.InvalidVersion", "Version must be >= 1.");
        if (string.IsNullOrWhiteSpace(geoJson))
            throw new DomainException("GeometryVersion.EmptyGeometry", "GeoJson is required.");

        return new GeometryVersion(
            id: $"geomver-{Guid.CreateVersion7():N}",
            assetId: assetId,
            assetKind: assetKind,
            version: version,
            geoJson: geoJson,
            changedBy: changedBy?.Trim(),
            reason: reason?.Trim(),
            changedAt: DateTime.UtcNow);
    }

    /// <summary>Reconstitute from a persistence model for read paths — no validation.</summary>
    public static GeometryVersion Reconstitute(string id, string assetId, AssetKind assetKind,
        int version, string geoJson, string? changedBy, string? reason, DateTime changedAt)
        => new(id, assetId, assetKind, version, geoJson, changedBy, reason, changedAt);
}
