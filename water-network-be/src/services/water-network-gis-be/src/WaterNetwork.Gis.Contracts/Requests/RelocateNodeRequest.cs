namespace WaterNetwork.Gis.Contracts.Requests;

public sealed record RelocateNodeRequest(
    double Latitude,
    double Longitude,
    string? Reason);
