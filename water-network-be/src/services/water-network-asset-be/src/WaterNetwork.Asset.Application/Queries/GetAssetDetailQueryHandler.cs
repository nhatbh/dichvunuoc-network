using WaterNetwork.Asset.Application.Dtos;
using WaterNetwork.Asset.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Asset.Application.Queries;

public sealed class GetAssetDetailQueryHandler(
    IAssetReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetAssetDetailQuery, AssetDetailDto?>
{
    public Task<AssetDetailDto?> HandleAsync(GetAssetDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetDetailAsync(tenant.TenantId, query.AssetId, ct);
    }
}
