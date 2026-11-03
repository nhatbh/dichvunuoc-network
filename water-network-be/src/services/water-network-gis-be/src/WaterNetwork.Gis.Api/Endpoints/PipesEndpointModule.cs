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

public sealed class PipesEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/network/pipes");

        group.MapPost("/", async (RegisterPipeRequest request, ICommandBus commandBus, CancellationToken ct) =>
            {
                var points = request.Points
                    .Select(p => (p.Lat, p.Lng))
                    .ToList();

                var id = await commandBus.ExecuteAsync(
                    new RegisterPipeCommand(
                        request.AssetCode,
                        request.FromNodeId,
                        request.ToNodeId,
                        points,
                        request.DiameterMm,
                        request.Material,
                        request.LengthM), ct);

                return Results.Created($"/api/network/pipes/{id}", new { id });
            })
            .WithValidation<RegisterPipeRequest>()
            .RequirePermission("network-gis:write");

        group.MapGet("/{id}", async Task<Results<Ok<PipeDetailDto>, NotFound>> (
                string id, IQueryBus queryBus, CancellationToken ct) =>
            {
                var pipe = await queryBus.ExecuteAsync(new GetPipeDetailQuery(id), ct);
                return pipe is null ? TypedResults.NotFound() : TypedResults.Ok(pipe);
            })
            .RequirePermission("network-gis:read");

        group.MapDelete("/{id}", async (string id, ICommandBus commandBus, CancellationToken ct) =>
            {
                await commandBus.ExecuteAsync(new RemovePipeCommand(id), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-gis:write");
    }
}
