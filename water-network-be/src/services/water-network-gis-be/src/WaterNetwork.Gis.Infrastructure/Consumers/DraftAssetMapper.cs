using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Domain.ValueObjects;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>Thrown when a draft cannot be mapped to GIS factory args (bad attribute, unresolved ref).
/// The import consumer catches it and records a failed[] entry — it never aborts the batch.</summary>
public sealed class DraftMappingException(string message) : Exception(message);

public sealed record PipeImportArgs(
    string FromNodeId, string ToNodeId, IReadOnlyList<GeoPoint> Points,
    int DiameterMm, string Material, double? LengthM);

public sealed record DeviceImportArgs(
    string DeviceType, string HostPipeOrNodeId, GeoPoint Location);

public static class DraftAssetMapper
{
    public static (GeoPoint Point, NodeType NodeType) MapNode(ReadyForGisAssetV1 a)
    {
        var point = SinglePoint(a);
        var nodeTypeRaw = Require(a, "nodeType");
        if (!Enum.TryParse<NodeType>(nodeTypeRaw, ignoreCase: true, out var nodeType) || !Enum.IsDefined(nodeType))
            throw new DraftMappingException($"Draft '{a.AssetCode}': invalid nodeType '{nodeTypeRaw}'.");
        return (point, nodeType);
    }

    public static PipeImportArgs MapPipe(ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> clientRefToGisId)
    {
        if (a.Geometry.Type != "LineString" || a.Geometry.Coordinates.Count < 2)
            throw new DraftMappingException($"Draft '{a.AssetCode}': pipe needs a LineString with >= 2 points.");
        var from = ResolveRef(a, a.FromRef, "fromRef", clientRefToGisId);
        var to = ResolveRef(a, a.ToRef, "toRef", clientRefToGisId);
        var diameterRaw = Require(a, "diameterMm");
        if (!int.TryParse(diameterRaw, out var diameter) || diameter <= 0)
            throw new DraftMappingException($"Draft '{a.AssetCode}': invalid diameterMm '{diameterRaw}'.");
        var material = Require(a, "material");
        double? lengthM = a.Attributes.TryGetValue("lengthM", out var lr) && double.TryParse(lr, out var l) ? l : null;
        var points = a.Geometry.Coordinates.Select(ToGeoPoint).ToList();
        return new PipeImportArgs(from, to, points, diameter, material, lengthM);
    }

    public static DeviceImportArgs MapDevice(ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> clientRefToGisId)
    {
        var location = SinglePoint(a);
        var deviceType = Require(a, "deviceType");
        var hostId = ResolveRef(a, a.HostRef, "hostRef", clientRefToGisId);
        return new DeviceImportArgs(deviceType, hostId, location);
    }

    private static GeoPoint SinglePoint(ReadyForGisAssetV1 a)
    {
        if (a.Geometry.Type != "Point" || a.Geometry.Coordinates.Count != 1)
            throw new DraftMappingException($"Draft '{a.AssetCode}': expected a single Point geometry.");
        return ToGeoPoint(a.Geometry.Coordinates[0]);
    }

    // GeoJSON [lng, lat] → GeoPoint(latitude, longitude)
    private static GeoPoint ToGeoPoint(IReadOnlyList<double> c) => new(c[1], c[0]);

    private static string Require(ReadyForGisAssetV1 a, string key)
        => a.Attributes.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v)
            ? v
            : throw new DraftMappingException($"Draft '{a.AssetCode}': missing required attribute '{key}'.");

    private static string ResolveRef(ReadyForGisAssetV1 a, string? @ref, string field,
        IReadOnlyDictionary<string, string> map)
    {
        if (string.IsNullOrWhiteSpace(@ref))
            throw new DraftMappingException($"Draft '{a.AssetCode}': {field} is required.");
        return map.TryGetValue(@ref, out var gisId)
            ? gisId
            : throw new DraftMappingException($"Draft '{a.AssetCode}': {field} '{@ref}' did not resolve to an imported asset in this batch.");
    }
}
