namespace WaterNetwork.Asset.Application.Dtos;

public sealed record AssetSummaryDto(string Id, string AssetType, string AssetCode, string Status, DateTime UpdatedAt);
