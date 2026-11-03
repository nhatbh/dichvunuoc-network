namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>v1 payload for <c>asset.decommissioned</c> — emitted additionally on decommission.</summary>
public sealed record AssetDecommissionedV1(string AssetId, string AssetType, string? Reason, string DecommissionedBy);
