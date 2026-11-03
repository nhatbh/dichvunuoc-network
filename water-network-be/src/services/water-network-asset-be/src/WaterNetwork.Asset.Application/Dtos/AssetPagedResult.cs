namespace WaterNetwork.Asset.Application.Dtos;

/// <summary>Paged result for asset list queries — mirrors PaginatedResponse shape from BuildingBlocks.WebApi.</summary>
public sealed record AssetPagedResult(
    IReadOnlyList<AssetSummaryDto> Data,
    int Page,
    int PageSize,
    long Total);
