using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class GetDeviceDetailQueryHandler(
    IDeviceReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetDeviceDetailQuery, DeviceDetailDto?>
{
    public Task<DeviceDetailDto?> HandleAsync(GetDeviceDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetByIdAsync(tenant.TenantId, query.DeviceId, ct);
    }
}
