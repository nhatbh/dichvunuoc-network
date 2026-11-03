using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class ReportIncidentCommandHandler(
    INetworkIncidentRepository repository,
    IGisLookupPort gisLookup,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<ReportIncidentCommand, string>
{
    public async Task<string> HandleAsync(ReportIncidentCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to report an incident.");
        var reportedBy = requestContextProvider.Current()?.UserId ?? "unknown";

        var refs = new List<AssetRef>(command.AffectedRefs.Count);
        foreach (var r in command.AffectedRefs)
        {
            var verified = await gisLookup.AssetRefExists(tenant.TenantId, r.Kind, r.AssetId, ct);
            refs.Add(AssetRef.Create(r.AssetId, r.Kind, verified));
        }

        var incident = NetworkIncident.Report(
            tenant.TenantId, command.Category, command.Severity,
            command.Longitude, command.Latitude, refs, reportedBy);

        await repository.SaveAsync(incident, ct);
        return incident.Id;
    }
}
