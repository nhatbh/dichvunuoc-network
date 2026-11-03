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

public sealed class RegisterNodeCommandHandler(
    INetworkNodeRepository repository,
    ITenantContextAccessor tenantAccessor,
    IGeometryVersionStore geometryVersionStore,
    IRequestContextProvider requestContextProvider) : ICommandHandler<RegisterNodeCommand, string>
{
    public async Task<string> HandleAsync(RegisterNodeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to register a node.");

        if (await repository.ExistsByAssetCodeAsync(tenant.TenantId, command.AssetCode, ct))
        {
            throw ConflictException.Duplicate("NetworkNode", nameof(command.AssetCode), command.AssetCode);
        }

        var node = NetworkNode.Register(
            tenant.TenantId,
            new AssetCode(command.AssetCode),
            Enum.Parse<NodeType>(command.NodeType, ignoreCase: true),
            new GeoPoint(command.Latitude, command.Longitude));

        var changedBy = requestContextProvider.Current()?.UserId ?? tenant.TenantId;
        var version = await geometryVersionStore.GetNextVersionAsync(node.Id, ct);
        var geoJson = GeoJsonHelper.GeoJsonPoint(command.Longitude, command.Latitude);
        await geometryVersionStore.AppendAsync(
            GeometryVersion.Create(
                node.Id,
                AssetKind.Parse("Node"),
                version,
                geoJson,
                changedBy: changedBy,
                reason: null),
            ct);

        try
        {
            await repository.SaveAsync(node, ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("NetworkNode", nameof(command.AssetCode), command.AssetCode);
        }

        return node.Id;
    }
}
