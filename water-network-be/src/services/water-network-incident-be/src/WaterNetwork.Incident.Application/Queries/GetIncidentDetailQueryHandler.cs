using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Queries;

public sealed class GetIncidentDetailQueryHandler(
    IIncidentReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetIncidentDetailQuery, IncidentDetailDto?>
{
    public Task<IncidentDetailDto?> HandleAsync(GetIncidentDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetDetailAsync(tenant.TenantId, query.IncidentId, ct);
    }
}
