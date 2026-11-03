using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class AssetCodeExistsQueryHandler(
    INetworkNodeRepository nodeRepository,
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<AssetCodeExistsQuery, bool>
{
    public async Task<bool> HandleAsync(AssetCodeExistsQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var assetCode = query.AssetCode.Trim();

        // Repositories share a scoped DbContext, therefore these checks must remain
        // sequential. Parallel EF operations on the same context are not supported.
        return await nodeRepository.ExistsByAssetCodeAsync(tenant.TenantId, assetCode, ct)
            || await pipeRepository.ExistsByAssetCodeAsync(tenant.TenantId, assetCode, ct)
            || await deviceRepository.ExistsByAssetCodeAsync(tenant.TenantId, assetCode, ct);
    }
}
