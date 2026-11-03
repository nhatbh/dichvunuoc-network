namespace WaterNetwork.Design.Domain.ValueObjects;

/// <summary>Immutable view of a draft asset handed to <c>DesignRevision.BeginPublish</c> to build the
/// ready-for-gis event payload. Geometry coordinates are GeoJSON [lng, lat].</summary>
public sealed record DraftAssetSnapshot(
    string DraftAssetId,
    string Kind,
    string AssetCode,
    string? ClientRef,
    DraftGeometrySnapshot Geometry,
    IReadOnlyDictionary<string, string> Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);

public sealed record DraftGeometrySnapshot(
    string Type,
    IReadOnlyList<IReadOnlyList<double>> Coordinates);
