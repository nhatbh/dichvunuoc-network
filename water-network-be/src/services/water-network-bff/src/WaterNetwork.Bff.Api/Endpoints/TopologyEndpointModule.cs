using System.Net.Http.Headers;
using WaterNetwork.Bff.Api.Topology;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Bff.Api.Endpoints;

/// <summary>Body of <c>POST /api/gis/topology/isolation</c>: exactly one of pipeId, nodeId.</summary>
public sealed record IsolationRequest(string? PipeId, string? NodeId);

/// <summary>
/// Network topology for SYSTEM 3D (decision 0029): isolation zones, directed traces, nearest
/// valves and structural issues, answered by topology-rs over the published network.
/// </summary>
public sealed class TopologyEndpointModule : IEndpointModule
{
    private static readonly string[] Directions = ["upstream", "downstream", "all"];

    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/gis/topology");

        group.MapPost("/isolation", (IsolationRequest body, HttpContext http, ITopologyClient topology,
                ITenantContextAccessor tenant, CancellationToken ct) =>
            {
                var pipe = Clean(body.PipeId);
                var node = Clean(body.NodeId);
                if ((pipe is null) == (node is null))
                    return Task.FromResult(Invalid("Give exactly one of pipeId or nodeId."));
                return Run(http, tenant, (t, bearer) =>
                    topology.IsolateAsync(t, bearer, new TopologyStart(node, pipe), ct));
            })
            .RequirePermission("network-gis:read");

        group.MapGet("/trace", (string? from, string? direction, int? maxDepth, HttpContext http,
                ITopologyClient topology, ITenantContextAccessor tenant, CancellationToken ct) =>
            {
                var start = Clean(from);
                var dir = (direction ?? "downstream").Trim().ToLowerInvariant();
                if (start is null || !Directions.Contains(dir) || maxDepth is < 0 or > 10_000)
                    return Task.FromResult(Invalid("from is required; direction is upstream, downstream or all; maxDepth 0–10000."));
                return Run(http, tenant, (t, bearer) =>
                    topology.TraceAsync(t, bearer, start, dir, maxDepth ?? (dir == "all" ? 20 : 0), ct));
            })
            .RequirePermission("network-gis:read");

        group.MapGet("/nearest-valves", (string? nodeId, int? k, HttpContext http, ITopologyClient topology,
                ITenantContextAccessor tenant, CancellationToken ct) =>
            {
                var node = Clean(nodeId);
                if (node is null || k is < 1 or > 50)
                    return Task.FromResult(Invalid("nodeId is required; k is 1–50."));
                return Run(http, tenant, (t, bearer) => topology.NearestValvesAsync(t, bearer, node, k ?? 5, ct));
            })
            .RequirePermission("network-gis:read");

        group.MapGet("/issues", (HttpContext http, ITopologyClient topology, ITenantContextAccessor tenant,
                CancellationToken ct) => Run(http, tenant, (t, bearer) => topology.IssuesAsync(t, bearer, ct)))
            .RequirePermission("network-gis:read");
    }

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Length > 64 ? null : value.Trim();

    private static IResult Invalid(string detail) =>
        Results.Problem(detail, statusCode: 400, extensions: new Dictionary<string, object?> { ["code"] = "VALIDATION_FAILED" });

    private static async Task<IResult> Run<T>(HttpContext http, ITenantContextAccessor tenant,
        Func<string, string?, Task<T>> call)
    {
        var tenantId = tenant.Current?.TenantId;
        if (string.IsNullOrWhiteSpace(tenantId)) return Results.Forbid();
        var bearer = AuthenticationHeaderValue.TryParse(http.Request.Headers.Authorization.ToString(), out var auth)
            && string.Equals(auth.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase)
            ? auth.Parameter
            : null;
        try
        {
            return Results.Ok(await call(tenantId, bearer));
        }
        catch (TopologyUnavailableException ex)
        {
            return Results.Problem(ex.Message, statusCode: 503,
                extensions: new Dictionary<string, object?> { ["code"] = "TOPOLOGY_UNAVAILABLE" });
        }
    }
}
