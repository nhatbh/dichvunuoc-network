using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RelocateNodeCommandHandler(
    INetworkNodeRepository nodeRepository,
    IGeometryVersionStore geometryVersionStore,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider)
    : ICommandHandler<RelocateNodeCommand, string>
{
    public async Task<string> HandleAsync(RelocateNodeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to relocate a node.");

        var node = await nodeRepository.GetByIdAsync(tenant.TenantId, command.NodeId, ct)
            ?? throw NotFoundException.Entity("NetworkNode", command.NodeId);

        node.Relocate(new GeoPoint(command.Latitude, command.Longitude), command.Reason);

        var changedBy = requestContextProvider.Current()?.UserId ?? tenant.TenantId;
        var version = await geometryVersionStore.GetNextVersionAsync(node.Id, ct);
        var geoJson = GeoJsonHelper.GeoJsonPoint(command.Longitude, command.Latitude);
        var geometryVersion = GeometryVersion.Create(
            node.Id,
            AssetKind.Parse("Node"),
            version,
            geoJson,
            changedBy: changedBy,
            reason: command.Reason);

        await geometryVersionStore.AppendAsync(geometryVersion, ct);

        try
        {
            await nodeRepository.SaveAsync(node, ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("GeometryVersion", "version", version.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        return node.Id;
    }
}
