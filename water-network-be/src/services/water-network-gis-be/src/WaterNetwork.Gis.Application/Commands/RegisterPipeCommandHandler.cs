using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RegisterPipeCommandHandler(
    INetworkPipeRepository pipeRepository,
    INetworkNodeRepository nodeRepository,
    ITenantContextAccessor tenantAccessor,
    IPipeLengthCalculator lengthCalculator) : ICommandHandler<RegisterPipeCommand, string>
{
    private const double LengthToleranceFraction = 0.10;

    public async Task<string> HandleAsync(RegisterPipeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to register a pipe.");

        if (await pipeRepository.ExistsByAssetCodeAsync(tenant.TenantId, command.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkPipe", nameof(command.AssetCode), command.AssetCode);

        var fromNode = await nodeRepository.GetByIdAsync(tenant.TenantId, command.FromNodeId, ct);
        if (fromNode is null || fromNode.DeletedAt is not null)
            throw new BusinessRuleException(
                "NetworkPipe.EndpointNotFound",
                $"Node '{command.FromNodeId}' does not exist or has been deleted and cannot be used as a pipe endpoint.");

        var toNode = await nodeRepository.GetByIdAsync(tenant.TenantId, command.ToNodeId, ct);
        if (toNode is null || toNode.DeletedAt is not null)
            throw new BusinessRuleException(
                "NetworkPipe.EndpointNotFound",
                $"Node '{command.ToNodeId}' does not exist or has been deleted and cannot be used as a pipe endpoint.");

        var calculatedLength = await lengthCalculator.CalculateMetersAsync(command.Points, ct);

        double storedLength;
        string? warning;

        if (command.LengthM is null)
        {
            storedLength = calculatedLength;
            warning = null;
        }
        else
        {
            storedLength = command.LengthM.Value;
            if (calculatedLength <= 0)
            {
                // Cannot validate ratio when calculator returns a non-positive value; skip warning.
                warning = null;
            }
            else
            {
                var deviation = Math.Abs(command.LengthM.Value - calculatedLength) / calculatedLength;
                warning = deviation > LengthToleranceFraction
                    ? $"Supplied length {command.LengthM.Value:F2} m deviates {deviation:P1} from the calculated value of {calculatedLength:F2} m (tolerance 10%)."
                    : null;
            }
        }

        var geoPoints = command.Points
            .Select(p => new GeoPoint(p.Lat, p.Lng))
            .ToList();

        var pipe = NetworkPipe.Register(
            tenantId: tenant.TenantId,
            assetCode: new AssetCode(command.AssetCode),
            fromNodeId: command.FromNodeId,
            toNodeId: command.ToNodeId,
            geometry: new PipeGeometry(geoPoints),
            diameterMm: new Diameter(command.DiameterMm),
            material: PipeMaterial.Parse(command.Material),
            lengthM: storedLength,
            lengthValidationWarning: warning);

        try
        {
            await pipeRepository.SaveAsync(pipe, ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("NetworkPipe", nameof(command.AssetCode), command.AssetCode);
        }

        return pipe.Id;
    }
}
