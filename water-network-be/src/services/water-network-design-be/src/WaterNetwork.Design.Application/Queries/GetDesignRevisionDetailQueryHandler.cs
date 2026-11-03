using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed class GetDesignRevisionDetailQueryHandler(
    IDesignRevisionReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetDesignRevisionDetailQuery, DesignRevisionDetailDto?>
{
    public async Task<DesignRevisionDetailDto?> HandleAsync(GetDesignRevisionDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return await readDao.GetDetailAsync(tenant.TenantId, query.RevisionId, ct);
    }
}
