using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RemovePipeCommandHandler(
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<RemovePipeCommand, Unit>
{
    public async Task<Unit> HandleAsync(RemovePipeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to remove a pipe.");

        var pipe = await pipeRepository.GetByIdAsync(tenant.TenantId, command.PipeId, ct)
            ?? throw NotFoundException.Entity("NetworkPipe", command.PipeId);

        if (await deviceRepository.ExistsByHostPipeAsync(pipe.Id, ct))
            throw new BusinessRuleException(
                "NetworkPipe.HasAttachedDevices",
                $"Pipe '{pipe.Id}' hosts one or more devices and cannot be removed.");

        await pipeRepository.DeleteAsync(pipe.Id, ct);

        return Unit.Value;
    }
}
