namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkPipeDeletedV1(
    string PipeId,
    string TenantId,
    string AssetCode);
