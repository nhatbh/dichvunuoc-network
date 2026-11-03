using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

public sealed record AssetCodeExistsQuery(string AssetCode) : IQuery<bool>;
