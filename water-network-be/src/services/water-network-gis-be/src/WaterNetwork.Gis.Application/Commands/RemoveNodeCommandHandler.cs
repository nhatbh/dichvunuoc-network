using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RemoveNodeCommandHandler(
    INetworkNodeRepository nodeRepository,
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<RemoveNodeCommand, Unit>
{
    public async Task<Unit> HandleAsync(RemoveNodeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to remove a node.");

        // Tenant-scoped load: a node owned by another tenant resolves to null → 404 (anti-enumeration).
        var node = await nodeRepository.GetByIdAsync(tenant.TenantId, command.NodeId, ct)
            ?? throw NotFoundException.Entity("NetworkNode", command.NodeId);

        if (await pipeRepository.ExistsByEndpointNodeAsync(node.Id, ct))
            throw new BusinessRuleException(
                "NetworkNode.HasConnectedPipes",
                $"Node '{node.Id}' is an endpoint of one or more pipes and cannot be removed.");

        if (await deviceRepository.ExistsByHostNodeAsync(node.Id, ct))
            throw new BusinessRuleException(
                "NetworkNode.HasAttachedDevices",
                $"Node '{node.Id}' hosts one or more devices and cannot be removed.");

        await nodeRepository.DeleteAsync(node.Id, ct);

        return Unit.Value;
    }
}
