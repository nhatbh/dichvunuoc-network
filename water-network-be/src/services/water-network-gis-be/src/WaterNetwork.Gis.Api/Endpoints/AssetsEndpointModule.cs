using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using WaterNetwork.Gis.Application.Configuration;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Contracts.Requests;
using WaterNetwork.Gis.Contracts.Responses;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Gis.Api.Endpoints;

public sealed class AssetsEndpointModule : IEndpointModule
{
    private static readonly string[] AllTypes = ["node", "pipe", "device"];

    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/network/assets");

        group.MapGet("/", async (
                [AsParameters] GetAssetsInBboxRequest request,
                IQueryBus queryBus,
                IOptions<BboxQueryOptions> options,
                CancellationToken ct) =>
            {
                // The validation filter already guaranteed bbox parses, ordering/area/range
                // are valid, and limit is in range — so parsing here cannot fail.
                // Use the return value in a conditional to satisfy CA1806.
                if (!Bbox.TryParse(request.Bbox, out var bbox))
                    return Results.Problem("bbox parse failed unexpectedly after validation.", statusCode: 500);

                string[] types;
                if (string.IsNullOrWhiteSpace(request.Types))
                {
                    types = AllTypes;
                }
                else
                {
                    types = request.Types
                        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                        .Select(ToCanonicalType)
                        .Where(t => t is not null)
                        .Distinct()
                        .ToArray()!;
                }

                var limit = request.Limit ?? options.Value.DefaultLimit;

                var result = await queryBus.ExecuteAsync(
                    new GetAssetsInBboxQuery(bbox!.MinLng, bbox.MinLat, bbox.MaxLng, bbox.MaxLat, types, limit), ct);

                return Results.Ok(result);
            })
            .WithValidation<GetAssetsInBboxRequest>()
            .RequirePermission("network-gis:read");

        group.MapGet("/export", async (
                string? cursor,
                int? limit,
                IQueryBus queryBus,
                CancellationToken ct) =>
            {
                var pageSize = Math.Clamp(limit ?? 1000, 1, 5000);
                var result = await queryBus.ExecuteAsync(new ExportAssetsQuery(cursor, pageSize), ct);
                return Results.Ok(result);
            })
            .RequirePermission("network-gis:read");

        group.MapGet("/bootstrap", async (IQueryBus queryBus, CancellationToken ct) =>
            {
                var result = await queryBus.ExecuteAsync(new GetAssetBootstrapQuery(), ct);
                return Results.Ok(result);
            })
            .RequirePermission("network-gis:read");

        group.MapGet("/exists", async (
                string? assetCode,
                IQueryBus queryBus,
                CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(assetCode))
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        [nameof(assetCode)] = ["assetCode is required."]
                    });
                }

                var exists = await queryBus.ExecuteAsync(new AssetCodeExistsQuery(assetCode), ct);
                return Results.Ok(new AssetCodeExistsResponse(exists));
            })
            .RequirePermission("network-gis:read");
    }

    // Validation already restricts types to node/pipe/device (case-insensitive);
    // normalize to the canonical lowercase token the DAO matches on.
    private static string? ToCanonicalType(string raw)
    {
        if (string.Equals(raw, "node", StringComparison.OrdinalIgnoreCase)) return "node";
        if (string.Equals(raw, "pipe", StringComparison.OrdinalIgnoreCase)) return "pipe";
        if (string.Equals(raw, "device", StringComparison.OrdinalIgnoreCase)) return "device";
        return null;
    }
}
