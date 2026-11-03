using WaterNetwork.Gis.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

/// <summary>
/// Tenant-scoped spatial query. <c>Types</c> is normalized to lowercase tokens
/// (node|pipe|device). <c>Limit</c> is the resolved page size (default applied
/// at the endpoint). The handler fetches Limit+1 rows to detect truncation.
/// </summary>
public sealed record GetAssetsInBboxQuery(
    double MinLng,
    double MinLat,
    double MaxLng,
    double MaxLat,
    IReadOnlyList<string> Types,
    int Limit) : IQuery<AssetFeatureCollectionDto>;
