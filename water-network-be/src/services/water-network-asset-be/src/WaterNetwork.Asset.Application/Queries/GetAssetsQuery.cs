using WaterNetwork.Asset.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Asset.Application.Queries;

public sealed record GetAssetsQuery(string? Type, string? Status, int Page, int PageSize) : IQuery<AssetPagedResult>;
