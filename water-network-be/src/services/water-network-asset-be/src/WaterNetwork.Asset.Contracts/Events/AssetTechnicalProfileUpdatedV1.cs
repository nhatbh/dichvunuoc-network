namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>
/// v1 payload for <c>asset.technical-profile.updated</c>. Loose attributes are intentionally
/// excluded from the event — consumers needing them query GET /api/assets/{id}.
/// </summary>
public sealed record AssetTechnicalProfileUpdatedV1(
    string AssetId, string AssetType, int? InstallationYear, string? Manufacturer, string? Model);
