namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>
/// v1 payload for the <c>asset.registered</c> integration event. Emitted when a GIS asset
/// (node/pipe/device) first becomes a tracked asset profile. <c>AssetId</c> equals the GIS asset id.
/// </summary>
public sealed record AssetRegisteredV1(
    string AssetId,
    string TenantId,
    string AssetType,
    string AssetCode,
    string Status);
