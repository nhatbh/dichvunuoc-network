namespace WaterNetwork.Asset.Application.Dtos;

public sealed record AssetDetailDto(
    string Id,
    string TenantId,
    string AssetType,
    string AssetCode,
    string Status,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    AssetTechnicalProfileDto? TechnicalProfile,
    IReadOnlyList<AssetLifecycleEntryDto> LifecycleHistory);
