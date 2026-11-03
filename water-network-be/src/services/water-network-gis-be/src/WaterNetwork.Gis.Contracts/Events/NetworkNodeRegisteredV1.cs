namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkNodeRegisteredV1(
    string NodeId,
    string TenantId,
    string AssetCode,
    string NodeType,
    double Latitude,
    double Longitude);
