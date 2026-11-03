using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Queries;

public sealed class ListIncidentsQueryHandler(
    IIncidentReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<ListIncidentsQuery, IReadOnlyList<IncidentSummaryDto>>
{
    public Task<IReadOnlyList<IncidentSummaryDto>> HandleAsync(ListIncidentsQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.ListAsync(tenant.TenantId, query.Status, query.Severity, ct);
    }
}
