using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Asset.Application.Commands;
using WaterNetwork.Asset.Application.Dtos;
using WaterNetwork.Asset.Application.Queries;
using WaterNetwork.Asset.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Asset.Api.Endpoints;

public sealed class AssetsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/assets");

        group.MapPost("/{id}/activate", async (string id, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ActivateAssetCommand(id, null), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-asset:write");

        group.MapPost("/{id}/maintenance", async (string id, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new MarkAssetAsMaintenanceCommand(id, null), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-asset:write");

        group.MapPost("/{id}/suspend", async (string id, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new SuspendAssetCommand(id, null), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-asset:write");

        group.MapPost("/{id}/decommission", async (string id, DecommissionAssetRequest? req, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new DecommissionAssetCommand(id, req?.Reason), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-asset:write");

        group.MapPut("/{id}/technical-profile", async (string id, UpdateAssetTechnicalProfileRequest req, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new UpdateAssetTechnicalProfileCommand(
                    id, req.InstallationYear, req.Manufacturer, req.Model,
                    req.Attributes ?? new Dictionary<string, string?>()), ct);
                return Results.NoContent();
            })
            .WithValidation<UpdateAssetTechnicalProfileRequest>()
            .RequirePermission("network-asset:write");

        group.MapGet("/{id}", async Task<Results<Ok<AssetDetailDto>, NotFound>> (string id, IQueryBus bus, CancellationToken ct) =>
            {
                var dto = await bus.ExecuteAsync(new GetAssetDetailQuery(id), ct);
                return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
            })
            .RequirePermission("network-asset:read");

        group.MapGet("/", async (string? type, string? status, int? page, int? pageSize, IQueryBus bus, CancellationToken ct) =>
            {
                var p = Math.Max(page ?? 1, 1);
                var size = Math.Clamp(pageSize ?? 20, 1, 200);
                var result = await bus.ExecuteAsync(new GetAssetsQuery(type, status, p, size), ct);
                return Results.Ok(result);
            })
            .RequirePermission("network-asset:read");
    }
}
