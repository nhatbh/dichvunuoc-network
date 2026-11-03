using Microsoft.AspNetCore.Mvc;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class ImportsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/design/imports", async (
                CreateDesignImportRequest request, IDesignImportIngestor ingestor, CancellationToken ct) =>
            {
                var input = new DesignImportInput(request.ImportKey, request.Name,
                    request.Assets.Select(a => new DraftAssetInput(a.Kind, a.AssetCode, a.ClientRef,
                        new DraftGeometryInput(a.Geometry.Type, a.Geometry.Coordinates),
                        a.Attributes ?? new Dictionary<string, string>(), a.FromRef, a.ToRef, a.HostRef)).ToList(),
                    request.Provenance);
                return Results.Ok(await ingestor.IngestAsync(input, ct));
            })
            .WithMetadata(new RequestSizeLimitAttribute(100L * 1024 * 1024))
            .WithValidation<CreateDesignImportRequest>()
            .RequirePermission("network-design:write");
    }
}
