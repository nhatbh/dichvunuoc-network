using System.Text.Json.Nodes;

namespace WaterNetwork.Gis.Application.Dtos;

/// <summary>
/// GeoJSON-shaped response for the bbox asset query (US-P1-04). Serializes to a
/// standard FeatureCollection so map clients render it directly. <c>Truncated</c>
/// is a GeoJSON foreign member (allowed) signalling the limit was hit.
/// </summary>
public sealed record AssetFeatureCollectionDto(
    IReadOnlyList<AssetFeatureDto> Features,
    bool Truncated)
{
    public string Type { get; } = "FeatureCollection";
}

public sealed record AssetFeatureDto(
    string Id,
    JsonNode Geometry,
    AssetFeaturePropertiesDto Properties)
{
    public string Type { get; } = "Feature";
}

/// <summary>
/// Flat property bag for one asset feature. Type-specific fields are null for
/// kinds they do not apply to. <c>LifecycleStatus</c> is always null in GIS-4 —
/// GIS-5 populates it from the network_asset_states projection.
/// </summary>
public sealed record AssetFeaturePropertiesDto(
    string Kind,               // Node | Pipe | Device
    string AssetCode,
    string Status,
    string? LifecycleStatus,   // GIS-5: from network_asset_states; null here
    string? NodeType,          // Node only
    int? DiameterMm,           // Pipe only
    string? Material,          // Pipe only
    double? LengthM,           // Pipe only
    string? FromNodeId,        // Pipe only
    string? ToNodeId,          // Pipe only
    string? DeviceType,        // Device only
    string? HostPipeId,        // Device only
    string? HostNodeId);       // Device only
