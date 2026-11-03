using WaterNetwork.Asset.Application.Dtos;
using WaterNetwork.Asset.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Asset.Application.Queries;

public sealed class GetAssetsQueryHandler(
    IAssetReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetAssetsQuery, AssetPagedResult>
{
    public Task<AssetPagedResult> HandleAsync(GetAssetsQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetPagedAsync(tenant.TenantId, query.Type, query.Status, query.Page, query.PageSize, ct);
    }
}
