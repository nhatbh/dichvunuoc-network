namespace WaterNetwork.Gis.Contracts.Requests;

public sealed record GeoPointRequest(double Lat, double Lng);

public sealed record RegisterPipeRequest(
    string AssetCode,
    string FromNodeId,
    string ToNodeId,
    IReadOnlyList<GeoPointRequest> Points,
    double DiameterMm,
    string Material,
    double? LengthM);
