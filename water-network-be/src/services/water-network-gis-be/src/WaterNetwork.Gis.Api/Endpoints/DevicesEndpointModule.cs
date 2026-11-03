using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Gis.Api.Endpoints;

public sealed class DevicesEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/network/devices");

        group.MapPost("/", async (InstallDeviceRequest request, ICommandBus commandBus, CancellationToken ct) =>
            {
                var id = await commandBus.ExecuteAsync(
                    new InstallDeviceCommand(
                        request.AssetCode,
                        request.DeviceType,
                        request.HostPipeId,
                        request.HostNodeId,
                        request.Latitude,
                        request.Longitude), ct);

                return Results.Created($"/api/network/devices/{id}", new { id });
            })
            .WithValidation<InstallDeviceRequest>()
            .RequirePermission("network-gis:write");

        group.MapGet("/{id}", async Task<Results<Ok<DeviceDetailDto>, NotFound>> (
                string id, IQueryBus queryBus, CancellationToken ct) =>
            {
                var device = await queryBus.ExecuteAsync(new GetDeviceDetailQuery(id), ct);
                return device is null ? TypedResults.NotFound() : TypedResults.Ok(device);
            })
            .RequirePermission("network-gis:read");

        group.MapDelete("/{id}", async (string id, ICommandBus commandBus, CancellationToken ct) =>
            {
                await commandBus.ExecuteAsync(new RemoveDeviceCommand(id), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-gis:write");
    }
}
