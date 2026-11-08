namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkNodeRegisteredV2(
    string NodeId,
    string TenantId,
    string AssetCode,
    string ComponentCode,
    IReadOnlyList<string> Functions,
    IReadOnlyDictionary<string, string> Properties,
    double Latitude,
    double Longitude);
