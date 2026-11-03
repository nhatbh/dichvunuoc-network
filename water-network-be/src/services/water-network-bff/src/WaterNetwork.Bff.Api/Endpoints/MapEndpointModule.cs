using Microsoft.AspNetCore.Http;
using WaterNetwork.Bff.Api.Http;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Bff.Api.Endpoints;

public sealed class MapEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var bffMap = app.MapGroup("/bff/water-network/map");
        MapRoute(bffMap);
        MapBootstrapRoute(bffMap);

        MapRoute(app.MapGroup("/api/gis/map"));
        MapBootstrapRoute(app.MapGroup("/api/gis"));
    }

    private static void MapRoute(RouteGroupBuilder group)
    {
        group.MapGet("/", async (
                string? bbox,
                string? types,
                int? limit,
                IGisApiClient gis,
                CancellationToken ct) =>
            {
                var result = await gis.GetMapAsync(bbox, types, limit, ct);
                return result.Unavailable
                    ? Results.Problem("GIS source unavailable.", statusCode: 502)
                    : Results.Json(result.Body, statusCode: result.StatusCode);
            })
            .RequirePermission("network-gis:read");
    }

    private static void MapBootstrapRoute(RouteGroupBuilder group)
    {
        group.MapGet("/bootstrap", async (IGisApiClient gis, CancellationToken ct) =>
            {
                var result = await gis.GetBootstrapAsync(ct);
                return result.Unavailable
                    ? Results.Problem("GIS source unavailable.", statusCode: 502)
                    : Results.Json(result.Body, statusCode: result.StatusCode);
            })
            .RequirePermission("network-gis:read");
    }
}
