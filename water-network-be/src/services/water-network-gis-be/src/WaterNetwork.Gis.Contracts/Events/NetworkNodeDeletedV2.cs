namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkNodeDeletedV1(
    string NodeId,
    string TenantId,
    string AssetCode,
    string NodeType);
