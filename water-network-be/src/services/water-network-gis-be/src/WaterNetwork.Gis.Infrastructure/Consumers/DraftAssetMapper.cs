using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Components;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>Thrown when a draft cannot be mapped to GIS factory args (bad attribute, unresolved ref).
/// The import consumer catches it and records a failed[] entry — it never aborts the batch.</summary>
public sealed class DraftMappingException(string message) : Exception(message);

public sealed record NodeImportArgs(GeoPoint Point, ComponentCode Component, AssetProperties Properties);

public sealed record PipeImportArgs(
    string FromNodeId, string ToNodeId, IReadOnlyList<GeoPoint> Points,
    int DiameterMm, string Material, double? LengthM,
    ComponentCode Component, AssetProperties Properties);

public sealed record DeviceImportArgs(
    ComponentCode Component, string HostPipeOrNodeId, GeoPoint Location, AssetProperties Properties);

/// <summary>
/// Maps a design draft to GIS factory args. Drafts name their component in the
/// <c>componentCode</c> attribute (decision 0028); catalog-declared properties are taken from
/// the other attributes and validated, everything else (design provenance) is dropped.
/// </summary>
public static class DraftAssetMapper
{
    public static NodeImportArgs MapNode(ReadyForGisAssetV1 a)
    {
        var point = SinglePoint(a);
        var component = Component(a, ComponentKind.Node, required: true);
        return new NodeImportArgs(point, component, Properties(a, component));
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
        var component = Component(a, ComponentKind.Pipe, required: false);
        return new PipeImportArgs(from, to, points, diameter, material, lengthM, component, Properties(a, component));
    }

    public static DeviceImportArgs MapDevice(ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> clientRefToGisId)
    {
        var location = SinglePoint(a);
        var component = Component(a, ComponentKind.Device, required: true);
        var hostId = ResolveRef(a, a.HostRef, "hostRef", clientRefToGisId);
        return new DeviceImportArgs(component, hostId, location, Properties(a, component));
    }

    private static ComponentCode Component(ReadyForGisAssetV1 a, ComponentKind kind, bool required)
    {
        if (!required && !a.Attributes.ContainsKey("componentCode"))
            return ComponentCode.Pipe;
        var raw = Require(a, "componentCode");
        try
        {
            return ComponentCode.Parse(raw, kind);
        }
        catch (DomainException ex)
        {
            throw new DraftMappingException($"Draft '{a.AssetCode}': {ex.Message}");
        }
    }

    private static AssetProperties Properties(ReadyForGisAssetV1 a, ComponentCode component)
    {
        try
        {
            return AssetProperties.FromAttributes(component, a.Attributes);
        }
        catch (DomainException ex)
        {
            throw new DraftMappingException($"Draft '{a.AssetCode}': {ex.Message}");
        }
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
