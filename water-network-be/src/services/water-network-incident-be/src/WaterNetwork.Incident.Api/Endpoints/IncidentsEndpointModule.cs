using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Incident.Api.Requests;
using WaterNetwork.Incident.Application.Commands;
using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Queries;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Incident.Api.Endpoints;

public sealed class IncidentsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/incidents");

        group.MapPost("/", async (ReportIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var refs = (request.AffectedRefs ?? [])
                    .Select(r => new ReportIncidentAssetRef(r.AssetId, r.Kind)).ToList();
                var id = await bus.ExecuteAsync(new ReportIncidentCommand(
                    request.Category, request.Severity, request.Longitude, request.Latitude, refs), ct);
                return Results.Created($"/api/incidents/{id}", new { id });
            })
            .WithValidation<ReportIncidentRequest>()
            .RequirePermission("network-incident:write");

        group.MapGet("/", async Task<Ok<IReadOnlyList<IncidentSummaryDto>>> (
                string? status, int? severity, IQueryBus bus, CancellationToken ct) =>
            {
                var items = await bus.ExecuteAsync(new ListIncidentsQuery(status, severity), ct);
                return TypedResults.Ok(items);
            })
            .RequirePermission("network-incident:read");

        group.MapGet("/{id}", async Task<Results<Ok<IncidentDetailDto>, NotFound>> (
                string id, IQueryBus bus, CancellationToken ct) =>
            {
                var dto = await bus.ExecuteAsync(new GetIncidentDetailQuery(id), ct);
                return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
            })
            .RequirePermission("network-incident:read");

        group.MapPost("/{id}/classify", async (
                string id, ClassifyIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ClassifyIncidentCommand(id, request.Category, request.Severity, request.Note), ct);
                return Results.NoContent();
            })
            .WithValidation<ClassifyIncidentRequest>()
            .RequirePermission("network-incident:write");

        group.MapPost("/{id}/cancel", async (
                string id, CancelIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new CancelIncidentCommand(id, request.Reason), ct);
                return Results.NoContent();
            })
            .WithValidation<CancelIncidentRequest>()
            .RequirePermission("network-incident:write");

        group.MapPost("/{id}/isolation-analysis", async Task<Ok<IsolationAnalysisResultDto>> (
                string id, RequestIsolationAnalysisRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var result = await bus.ExecuteAsync(
                    new RequestIsolationAnalysisCommand(id, request.StartNodeId), ct);
                return TypedResults.Ok(result);
            })
            .WithValidation<RequestIsolationAnalysisRequest>()
            .RequirePermission("network-incident:write");

        group.MapPost("/{id}/isolation-plan/confirm", async (
                string id, ConfirmIsolationPlanRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ConfirmIsolationPlanCommand(id, request.Note), ct);
                return Results.NoContent();
            })
            .WithValidation<ConfirmIsolationPlanRequest>()
            .RequirePermission("network-incident:confirm");

        group.MapPost("/{id}/start-handling", async (
                string id, StartIncidentHandlingRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new StartIncidentHandlingCommand(id, request.Note), ct);
                return Results.NoContent();
            })
            .WithValidation<StartIncidentHandlingRequest>()
            .RequirePermission("network-incident:write");

        group.MapPost("/{id}/resolve", async (
                string id, ResolveIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ResolveIncidentCommand(id, request.ResolutionNote), ct);
                return Results.NoContent();
            })
            .WithValidation<ResolveIncidentRequest>()
            .RequirePermission("network-incident:write");
    }
}
