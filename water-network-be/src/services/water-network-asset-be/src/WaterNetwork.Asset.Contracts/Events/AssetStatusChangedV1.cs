namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>
/// v1 payload for <c>asset.status.changed</c> — the universal lifecycle-transition signal.
/// Consumed by GIS-5 (projection) and later maintenance/observation. Emitted on EVERY transition.
/// </summary>
public sealed record AssetStatusChangedV1(
    string AssetId, string AssetType, string PreviousStatus, string NewStatus, string? Reason, string ChangedBy);
