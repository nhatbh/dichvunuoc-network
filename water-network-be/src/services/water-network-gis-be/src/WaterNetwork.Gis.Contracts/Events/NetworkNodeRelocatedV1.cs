namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkNodeRelocatedV1(
    string NodeId,
    string TenantId,
    string AssetCode,
    double OldLatitude,
    double OldLongitude,
    double NewLatitude,
    double NewLongitude,
    string? Reason);
