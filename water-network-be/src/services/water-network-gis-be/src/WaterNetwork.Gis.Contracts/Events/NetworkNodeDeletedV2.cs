namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkNodeDeletedV2(
    string NodeId,
    string TenantId,
    string AssetCode,
    string ComponentCode);
