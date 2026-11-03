using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class GetNodeGeometryHistoryQueryHandler(
    IGeometryVersionReadDao readDao,
    INodeReadDao nodeReadDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetNodeGeometryHistoryQuery, IReadOnlyList<GeometryVersionDto>>
{
    public async Task<IReadOnlyList<GeometryVersionDto>> HandleAsync(GetNodeGeometryHistoryQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        // Verify the node exists AND belongs to the caller's tenant before returning history.
        // geometry_versions has no tenant_id column; isolation is enforced here via the tenant-scoped node lookup.
        _ = await nodeReadDao.GetByIdAsync(tenant.TenantId, query.NodeId, ct)
            ?? throw NotFoundException.Entity("NetworkNode", query.NodeId);

        return await readDao.ListByAssetAsync(query.NodeId, ct);
    }
}
