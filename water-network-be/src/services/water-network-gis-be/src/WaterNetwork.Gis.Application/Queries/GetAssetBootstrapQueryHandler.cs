using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class GetAssetBootstrapQueryHandler(
    IAssetBootstrapReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetAssetBootstrapQuery, AssetBootstrapDto>
{
    private const int SchemaVersion = 1;
    private const string DataExtentSource = "data_extent";

    public async Task<AssetBootstrapDto> HandleAsync(GetAssetBootstrapQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var snapshot = await readDao.QueryAsync(tenant.TenantId, ct);
        var homeView = BuildHomeView(snapshot);

        return new AssetBootstrapDto(
            SchemaVersion,
            HasData: snapshot.Total > 0,
            HomeView: homeView,
            Counts: new AssetCountsDto(snapshot.Nodes, snapshot.Pipes, snapshot.Devices, snapshot.Total),
            PipeLengthM: snapshot.PipeLengthM,
            MaterialMix: snapshot.MaterialMix
                .Select(x => new MaterialMixItemDto(x.Material, x.Count, x.LengthM))
                .ToList(),
            StatusMix: snapshot.StatusMix
                .Select(x => new StatusMixItemDto(x.Status, x.Count))
                .ToList());
    }

    private static AssetHomeViewDto? BuildHomeView(AssetBootstrapSnapshot snapshot)
    {
        if (snapshot.Total == 0)
            return null;

        if (snapshot.MinLon is null || snapshot.MinLat is null ||
            snapshot.MaxLon is null || snapshot.MaxLat is null)
        {
            throw new InvalidOperationException("GIS assets exist but their spatial extent could not be calculated.");
        }

        var minLon = snapshot.MinLon.Value;
        var minLat = snapshot.MinLat.Value;
        var maxLon = snapshot.MaxLon.Value;
        var maxLat = snapshot.MaxLat.Value;

        return new AssetHomeViewDto(
            Bbox: [minLon, minLat, maxLon, maxLat],
            Center: new AssetHomeViewCenterDto((minLon + maxLon) / 2, (minLat + maxLat) / 2),
            Source: DataExtentSource);
    }
}
