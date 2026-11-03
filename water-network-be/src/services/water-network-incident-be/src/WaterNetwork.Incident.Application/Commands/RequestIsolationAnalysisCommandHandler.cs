using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class RequestIsolationAnalysisCommandHandler(
    INetworkIncidentRepository repository,
    ITopologyAnalysisPort topology,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider)
    : ICommandHandler<RequestIsolationAnalysisCommand, IsolationAnalysisResultDto>
{
    public async Task<IsolationAnalysisResultDto> HandleAsync(RequestIsolationAnalysisCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var incident = await repository.GetByIdAsync(command.IncidentId, ct);
        if (incident is null || incident.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("NetworkIncident", command.IncidentId);

        var actorId = requestContextProvider.Current()?.UserId ?? "unknown";
        incident.RequestIsolationAnalysis(command.StartNodeId, actorId);

        try
        {
            var zone = await topology.ComputeIsolationZoneAsync(tenant.TenantId, command.StartNodeId.Trim(), ct);
            incident.RecordIsolationPlan(zone.GraphVersion, zone.ValvesToClose, zone.IsolatedNodes, zone.IsolatedPipes, actorId);
        }
        catch (TopologyAnalysisException ex)
        {
            incident.RecordAnalysisFailure(ex.Message, actorId);
        }

        await repository.SaveAsync(incident, ct);

        var plan = incident.IsolationPlans[^1];
        return new IsolationAnalysisResultDto(
            incident.Id, plan.Id, plan.Status.ToString(), incident.Status.ToString(),
            plan.FailureReason, plan.GraphVersion, plan.ValvesToClose, plan.IsolatedNodes, plan.IsolatedPipes);
    }
}
