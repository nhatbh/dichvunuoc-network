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

public sealed class NodesEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/network/nodes");

        group.MapPost("/", async (RegisterNodeRequest request, ICommandBus commandBus, CancellationToken ct) =>
            {
                var id = await commandBus.ExecuteAsync(
                    new RegisterNodeCommand(request.AssetCode, request.NodeType, request.Latitude, request.Longitude), ct);
                return Results.Created($"/api/network/nodes/{id}", new { id });
            })
            .WithValidation<RegisterNodeRequest>()
            .RequirePermission("network-gis:write");

        group.MapGet("/{id}", async Task<Results<Ok<NodeDetailDto>, NotFound>> (
                string id, IQueryBus queryBus, CancellationToken ct) =>
            {
                var node = await queryBus.ExecuteAsync(new GetNodeDetailQuery(id), ct);
                return node is null ? TypedResults.NotFound() : TypedResults.Ok(node);
            })
            .RequirePermission("network-gis:read");

        group.MapDelete("/{id}", async (string id, ICommandBus commandBus, CancellationToken ct) =>
            {
                await commandBus.ExecuteAsync(new RemoveNodeCommand(id), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-gis:write");

        group.MapPatch("/{id}/location", async (string id, RelocateNodeRequest request, ICommandBus commandBus, CancellationToken ct) =>
            {
                await commandBus.ExecuteAsync(
                    new RelocateNodeCommand(id, request.Latitude, request.Longitude, request.Reason), ct);
                return Results.NoContent();
            })
            .WithValidation<RelocateNodeRequest>()
            .RequirePermission("network-gis:write");

        group.MapGet("/{id}/geometry-history", async (string id, IQueryBus queryBus, CancellationToken ct) =>
            {
                var history = await queryBus.ExecuteAsync(new GetNodeGeometryHistoryQuery(id), ct);
                return Results.Ok(history);
            })
            .RequirePermission("network-gis:read");
    }
}
