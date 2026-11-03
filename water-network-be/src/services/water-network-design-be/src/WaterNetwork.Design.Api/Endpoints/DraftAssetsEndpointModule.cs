using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class DraftAssetsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var revisionGroup = app.MapGroup("/api/design/revisions/{revisionId}/draft-assets");

        revisionGroup.MapPost("/", async (
                string revisionId, CreateDraftAssetRequest request, ICommandBus bus, IUnitOfWork work, CancellationToken ct) =>
            {
                var id = await work.ExecuteInTransactionAsync(_ => bus.ExecuteAsync(new CreateDraftAssetCommand(revisionId, ToInput(request)), ct), ct);
                return Results.Created($"/api/design/draft-assets/{id}", new { id });
            })
            .WithValidation<CreateDraftAssetRequest>()
            .RequirePermission("network-design:write");

        app.MapPost("/api/design/revisions/{revisionId}/draft-assets:batch", async (
                string revisionId, CreateDraftAssetsBatchRequest request, ICommandBus bus, IUnitOfWork work, CancellationToken ct) =>
            {
                var ids = await work.ExecuteInTransactionAsync(_ => bus.ExecuteAsync(
                    new CreateDraftAssetsBatchCommand(revisionId, request.Assets.Select(ToInput).ToList()), ct), ct);
                return Results.Created($"/api/design/revisions/{revisionId}/draft-assets", new { ids });
            })
            .WithValidation<CreateDraftAssetsBatchRequest>()
            .RequirePermission("network-design:write");

        app.MapPatch("/api/design/draft-assets/{id}/geometry", async (
                string id, UpdateDraftGeometryRequest request, ICommandBus bus, IUnitOfWork work, CancellationToken ct) =>
            {
                await work.ExecuteInTransactionAsync(_ => bus.ExecuteAsync(new UpdateDraftGeometryCommand(id, ToGeometry(request.Geometry)), ct), ct);
                return Results.NoContent();
            })
            .WithValidation<UpdateDraftGeometryRequest>()
            .RequirePermission("network-design:write");
    }

    private static DraftAssetInput ToInput(CreateDraftAssetRequest r) => new(
        r.Kind, r.AssetCode, r.ClientRef, ToGeometry(r.Geometry),
        r.Attributes ?? new Dictionary<string, string>(), r.FromRef, r.ToRef, r.HostRef);

    private static DraftGeometryInput ToGeometry(GeometryRequest g) => new(g.Type, g.Coordinates);
}
