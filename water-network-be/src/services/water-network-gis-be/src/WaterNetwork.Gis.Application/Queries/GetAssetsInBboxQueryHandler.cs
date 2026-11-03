using System.Text.Json.Nodes;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class GetAssetsInBboxQueryHandler(
    IBboxAssetReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetAssetsInBboxQuery, AssetFeatureCollectionDto>
{
    public async Task<AssetFeatureCollectionDto> HandleAsync(GetAssetsInBboxQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        // Fetch limit+1 so we can flag truncation without a second COUNT round-trip.
        var rows = await readDao.QueryAsync(tenant.TenantId, query, query.Limit + 1, ct);

        var truncated = rows.Count > query.Limit;
        var features = rows.Take(query.Limit).Select(MapFeature).ToList();

        return new AssetFeatureCollectionDto(features, truncated);
    }

    private static AssetFeatureDto MapFeature(BboxAssetRow row) =>
        new(
            Id: row.Id,
            Geometry: JsonNode.Parse(row.GeoJson)!,
            Properties: new AssetFeaturePropertiesDto(
                Kind: row.Kind,
                AssetCode: row.AssetCode,
                Status: row.Status,
                LifecycleStatus: row.LifecycleStatus,
                NodeType: row.NodeType,
                DiameterMm: row.DiameterMm,
                Material: row.Material,
                LengthM: row.LengthM,
                FromNodeId: row.FromNodeId,
                ToNodeId: row.ToNodeId,
                DeviceType: row.DeviceType,
                HostPipeId: row.HostPipeId,
                HostNodeId: row.HostNodeId));
}
