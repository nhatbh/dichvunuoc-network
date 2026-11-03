using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RemoveDeviceCommandHandler(
    INetworkDeviceRepository deviceRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<RemoveDeviceCommand, Unit>
{
    public async Task<Unit> HandleAsync(RemoveDeviceCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to remove a device.");

        var device = await deviceRepository.GetByIdAsync(tenant.TenantId, command.DeviceId, ct)
            ?? throw NotFoundException.Entity("NetworkDevice", command.DeviceId);

        await deviceRepository.DeleteAsync(device.Id, ct);

        return Unit.Value;
    }
}
