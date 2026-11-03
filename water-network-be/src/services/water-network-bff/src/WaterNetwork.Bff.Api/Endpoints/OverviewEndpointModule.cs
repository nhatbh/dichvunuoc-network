using Microsoft.AspNetCore.Http;
using WaterNetwork.Bff.Api.Contracts;
using WaterNetwork.Bff.Api.Http;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Bff.Api.Endpoints;

public sealed class OverviewEndpointModule : IEndpointModule
{
    private static readonly string[] ValidTypes = ["node", "pipe", "device"];

    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/bff/water-network/assets");

        group.MapGet("/{assetId}/overview", async (
                string assetId,
                string? type,
                IGisApiClient gis,
                IAssetApiClient asset,
                CancellationToken ct) =>
            {
                var t = (type ?? string.Empty).ToLowerInvariant();
                if (Array.IndexOf(ValidTypes, t) < 0)
                    return Results.Problem("Query parameter 'type' must be one of node|pipe|device.", statusCode: 400);

                // Fan out concurrently: both calls start before we await either.
                var gisTask = gis.GetDetailAsync(t, assetId, ct);
                var assetTask = asset.GetProfileAsync(assetId, ct);
                var gisResult = await gisTask;
                var assetResult = await assetTask;

                // GIS is authoritative for existence.
                if (gisResult.Status == DownstreamStatus.NotFound)
                    return Results.NotFound();
                if (gisResult.Status != DownstreamStatus.Ok)
                    return Results.Problem("GIS source unavailable.", statusCode: 502);

                // Asset degrades to null — never blocks the response.
                LifecycleDto? lifecycle = null;
                var assetSource = "unavailable";
                if (assetResult.Status == DownstreamStatus.Ok && assetResult.Value is not null)
                {
                    var p = assetResult.Value;
                    lifecycle = new LifecycleDto(p.Status, p.AssetCode, p.TechnicalProfile);
                    assetSource = "ok";
                }

                var response = new OverviewResponse(
                    assetId, t, gisResult.Value, lifecycle, new SourcesDto("ok", assetSource));
                return Results.Ok(response);
            })
            .RequireAuthorization();
    }
}
