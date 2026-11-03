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

public sealed class RevisionsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        // Create revision under a project.
        app.MapPost("/api/design/projects/{projectId}/revisions", async (
                string projectId, ICommandBus bus, CancellationToken ct) =>
            {
                var id = await bus.ExecuteAsync(new CreateDesignRevisionCommand(projectId), ct);
                return Results.Created($"/api/design/revisions/{id}", new { id });
            })
            .RequirePermission("network-design:write");

        var group = app.MapGroup("/api/design/revisions");

        // Validate revision — 200 even when there are business validation errors.
        group.MapPost("/{revisionId}/validate", async (
                string revisionId, ICommandBus bus, CancellationToken ct) =>
            {
                var result = await bus.ExecuteAsync(new ValidateRevisionCommand(revisionId), ct);
                return Results.Ok(result);
            })
            .RequirePermission("network-design:write");

        group.MapGet("/{revisionId}", async Task<Results<Ok<DesignRevisionDetailDto>, NotFound>> (
                string revisionId, IQueryBus bus, CancellationToken ct) =>
            {
                var dto = await bus.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
            })
            .RequirePermission("network-design:read");

        group.MapGet("/{revisionId}/preview", async Task<Results<Ok<IReadOnlyList<DraftAssetPreviewDto>>, NotFound>> (
                string revisionId, IQueryBus bus, CancellationToken ct) =>
            {
                var list = await bus.ExecuteAsync(new GetRevisionPreviewQuery(revisionId), ct);
                return list is null ? TypedResults.NotFound() : TypedResults.Ok(list);
            })
            .RequirePermission("network-design:read");

        group.MapGet("/{revisionId}/publish-result", async Task<Ok<IReadOnlyList<ImportResultDto>>> (
                string revisionId, IQueryBus bus, CancellationToken ct) =>
            {
                var rows = await bus.ExecuteAsync(new GetRevisionPublishResultQuery(revisionId), ct);
                return TypedResults.Ok(rows);
            })
            .RequirePermission("network-design:read");

        // Submit a Validated revision for approval.
        group.MapPost("/{revisionId}/submit", async (
                string revisionId, ICommandBus bus, IQueryBus queries, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new SubmitDesignRevisionCommand(revisionId), ct);
                var dto = await queries.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return Results.Ok(dto);
            })
            .RequirePermission("network-design:write");

        // Approve a Submitted revision (optional reason).
        group.MapPost("/{revisionId}/approve", async (
                string revisionId, ApproveRevisionRequest? request, ICommandBus bus, IQueryBus queries, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ApproveDesignRevisionCommand(revisionId, request?.Reason), ct);
                var dto = await queries.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return Results.Ok(dto);
            })
            .RequirePermission("network-design:approve");

        // Reject a Submitted revision (reason required) → back to Draft.
        group.MapPost("/{revisionId}/reject", async (
                string revisionId, RejectRevisionRequest request, ICommandBus bus, IQueryBus queries, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new RejectDesignRevisionCommand(revisionId, request.Reason), ct);
                var dto = await queries.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return Results.Ok(dto);
            })
            .WithValidation<RejectRevisionRequest>()
            .RequirePermission("network-design:approve");
    }
}
