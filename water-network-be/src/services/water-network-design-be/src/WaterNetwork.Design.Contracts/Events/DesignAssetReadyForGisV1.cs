namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.asset.ready-for-gis</c> — a full revision batch.</summary>
public sealed record DesignAssetReadyForGisV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ApprovedBy,
    IReadOnlyList<ReadyForGisAssetV1> Assets);

/// <summary>One draft asset in a ready-for-gis batch. <c>Geometry</c> coordinates are GeoJSON [lng, lat].</summary>
public sealed record ReadyForGisAssetV1(
    string DraftAssetId,
    string Kind,                  // "Node" | "Pipe" | "Device"
    string AssetCode,
    string? ClientRef,
    ReadyForGisGeometryV1 Geometry,
    IReadOnlyDictionary<string, string> Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);

public sealed record ReadyForGisGeometryV1(
    string Type,                  // "Point" | "LineString"
    IReadOnlyList<IReadOnlyList<double>> Coordinates);  // [[lng,lat], ...]
