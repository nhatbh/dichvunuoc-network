using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed class GetDesignProjectDetailQueryHandler(
    IDesignProjectReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetDesignProjectDetailQuery, DesignProjectDetailDto?>
{
    public Task<DesignProjectDetailDto?> HandleAsync(GetDesignProjectDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetDetailAsync(tenant.TenantId, query.ProjectId, ct);
    }
}
