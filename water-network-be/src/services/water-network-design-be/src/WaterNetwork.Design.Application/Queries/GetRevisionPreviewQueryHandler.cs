using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed class GetRevisionPreviewQueryHandler(
    IDesignRevisionReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetRevisionPreviewQuery, IReadOnlyList<DraftAssetPreviewDto>?>
{
    public async Task<IReadOnlyList<DraftAssetPreviewDto>?> HandleAsync(GetRevisionPreviewQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        // Return null when the revision does not exist (→ 404 at the endpoint); empty list is a valid preview.
        if (!await readDao.ExistsAsync(tenant.TenantId, query.RevisionId, ct))
            return null;

        return await readDao.ListPreviewAsync(tenant.TenantId, query.RevisionId, ct);
    }
}
