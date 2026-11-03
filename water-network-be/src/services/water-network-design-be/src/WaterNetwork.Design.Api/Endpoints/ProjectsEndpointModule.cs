using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Queries;
using WaterNetwork.Design.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class ProjectsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/design/projects");

        group.MapPost("/", async (CreateDesignProjectRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var id = await bus.ExecuteAsync(
                    new CreateDesignProjectCommand(request.Name, request.BranchId, request.ZoneId), ct);
                return Results.Created($"/api/design/projects/{id}", new { id });
            })
            .WithValidation<CreateDesignProjectRequest>()
            .RequirePermission("network-design:write");

        group.MapGet("/{id}", async Task<Results<Ok<DesignProjectDetailDto>, NotFound>> (
                string id, IQueryBus bus, CancellationToken ct) =>
            {
                var dto = await bus.ExecuteAsync(new GetDesignProjectDetailQuery(id), ct);
                return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
            })
            .RequirePermission("network-design:read");
    }
}
