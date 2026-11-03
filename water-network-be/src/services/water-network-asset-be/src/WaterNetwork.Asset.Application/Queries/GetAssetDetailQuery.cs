using WaterNetwork.Asset.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Asset.Application.Queries;

public sealed record GetAssetDetailQuery(string AssetId) : IQuery<AssetDetailDto?>;
