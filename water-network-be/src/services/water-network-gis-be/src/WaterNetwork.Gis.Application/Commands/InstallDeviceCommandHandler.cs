using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class InstallDeviceCommandHandler(
    INetworkDeviceRepository deviceRepository,
    INetworkPipeRepository pipeRepository,
    INetworkNodeRepository nodeRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<InstallDeviceCommand, string>
{
    public async Task<string> HandleAsync(InstallDeviceCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to install a device.");

        if (await deviceRepository.ExistsByAssetCodeAsync(tenant.TenantId, command.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkDevice", nameof(command.AssetCode), command.AssetCode);

        // Parse-first: host shape (400) is settled before any host-existence I/O (422).
        var deviceType = DeviceType.Parse(command.DeviceType);
        var host = DeviceHost.For(deviceType, command.HostPipeId, command.HostNodeId);

        if (host.HostPipeId is not null)
        {
            var pipe = await pipeRepository.GetByIdAsync(tenant.TenantId, host.HostPipeId, ct);
            if (pipe is null || pipe.DeletedAt is not null)
                throw new BusinessRuleException(
                    "NetworkDevice.HostNotFound",
                    $"Pipe '{host.HostPipeId}' does not exist or has been deleted and cannot host a device.");
        }

        if (host.HostNodeId is not null)
        {
            var node = await nodeRepository.GetByIdAsync(tenant.TenantId, host.HostNodeId, ct);
            if (node is null || node.DeletedAt is not null)
                throw new BusinessRuleException(
                    "NetworkDevice.HostNotFound",
                    $"Node '{host.HostNodeId}' does not exist or has been deleted and cannot host a device.");
        }

        var device = NetworkDevice.Install(
            tenantId: tenant.TenantId,
            assetCode: new AssetCode(command.AssetCode),
            deviceType: deviceType,
            host: host,
            location: new GeoPoint(command.Latitude, command.Longitude));

        try
        {
            await deviceRepository.SaveAsync(device, ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("NetworkDevice", nameof(command.AssetCode), command.AssetCode);
        }

        return device.Id;
    }
}
