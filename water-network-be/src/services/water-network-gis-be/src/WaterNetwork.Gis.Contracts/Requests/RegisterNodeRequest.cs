namespace WaterNetwork.Gis.Contracts.Requests;

/// <summary>A node: a fitting or facility from the component catalog (decision 0028).</summary>
public sealed record RegisterNodeRequest(
    string AssetCode,
    string ComponentCode,
    double Latitude,
    double Longitude,
    IReadOnlyDictionary<string, string>? Properties = null);
