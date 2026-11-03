using WaterNetwork.Incident.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class ConfirmIsolationPlanCommandHandler(
    INetworkIncidentRepository repository,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<ConfirmIsolationPlanCommand, Unit>
{
    public async Task<Unit> HandleAsync(ConfirmIsolationPlanCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var incident = await repository.GetByIdAsync(command.IncidentId, ct);
        if (incident is null || incident.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("NetworkIncident", command.IncidentId);

        var actorId = requestContextProvider.Current()?.UserId ?? "unknown";
        incident.ConfirmIsolationPlan(actorId, command.Note);
        await repository.SaveAsync(incident, ct);
        return Unit.Value;
    }
}
