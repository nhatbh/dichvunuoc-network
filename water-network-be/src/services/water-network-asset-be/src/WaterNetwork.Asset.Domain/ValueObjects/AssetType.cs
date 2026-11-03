namespace WaterNetwork.Asset.Domain.ValueObjects;

public enum AssetType
{
    Node,
    Pipe,
    Device
}

/// <summary>
/// Maps a GIS registration integration-event type string to the asset profile type.
/// Lives in Domain (no GIS dependency) keyed off the literal event-type strings.
/// </summary>
public static class AssetTypeMapping
{
    public static AssetType? FromGisEventType(string gisEventType) => gisEventType switch
    {
        "network.node.registered" => AssetType.Node,
        "network.pipe.registered" => AssetType.Pipe,
        "network.device.installed" => AssetType.Device,
        _ => null
    };
}
