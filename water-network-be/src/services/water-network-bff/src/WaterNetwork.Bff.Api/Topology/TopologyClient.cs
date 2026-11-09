using Grpc.Core;
using Waternetwork.Topology.V1;

namespace WaterNetwork.Bff.Api.Topology;

/// <summary>Where an isolation starts.</summary>
public sealed record TopologyStart(string? NodeId, string? PipeId);

public sealed record IsolationResult(
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedPipes,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> BoundaryPipes,
    IReadOnlyList<string> AffectedServices,
    long GraphVersion,
    bool GraphReady);

public sealed record TraceResult(
    IReadOnlyList<string> NodeIds,
    IReadOnlyList<string> PipeIds,
    IReadOnlyList<string> SourceNodeIds,
    long GraphVersion,
    bool GraphReady);

public sealed record NearestValveResult(string DeviceId, string PipeId, int Hops);

public sealed record NearestValvesResult(IReadOnlyList<NearestValveResult> Valves, long GraphVersion, bool GraphReady);

public sealed record TopologyIssueResult(string Type, IReadOnlyList<string> AssetIds);

public sealed record TopologyIssuesResult(IReadOnlyList<TopologyIssueResult> Issues, long GraphVersion, bool GraphReady);

/// <summary>topology-rs could not be reached, or is not configured.</summary>
public sealed class TopologyUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

public interface ITopologyClient
{
    Task<IsolationResult> IsolateAsync(string tenantId, string? bearer, TopologyStart start, CancellationToken ct);
    Task<TraceResult> TraceAsync(string tenantId, string? bearer, string fromNodeId, string direction, int maxDepth, CancellationToken ct);
    Task<NearestValvesResult> NearestValvesAsync(string tenantId, string? bearer, string nodeId, int k, CancellationToken ct);
    Task<TopologyIssuesResult> IssuesAsync(string tenantId, string? bearer, CancellationToken ct);
}

/// <summary>
/// topology-rs over gRPC (decision 0029). The caller's bearer goes along in the
/// <c>authorization</c> metadata so topology-rs can rebuild a missing graph from gis-be's export
/// with exactly the caller's rights. 5 s deadline; transport faults become
/// <see cref="TopologyUnavailableException"/>.
/// </summary>
public sealed class GrpcTopologyClient(TopologyService.TopologyServiceClient client) : ITopologyClient
{
    private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(5);

    public Task<IsolationResult> IsolateAsync(string tenantId, string? bearer, TopologyStart start, CancellationToken ct)
    {
        var request = new ComputeIsolationZoneRequest { TenantId = tenantId };
        if (start.PipeId is not null) request.StartPipeId = start.PipeId;
        else request.StartNodeId = start.NodeId ?? "";
        return Call(async options =>
        {
            var r = await client.ComputeIsolationZoneAsync(request, options);
            return new IsolationResult([.. r.ValvesToClose], [.. r.IsolatedPipes], [.. r.IsolatedNodes],
                [.. r.BoundaryPipeIds], [.. r.AffectedServiceIds], (long)r.GraphVersion, r.GraphReady);
        }, bearer, ct);
    }

    public Task<TraceResult> TraceAsync(string tenantId, string? bearer, string fromNodeId, string direction, int maxDepth, CancellationToken ct)
    {
        var request = new TraceNetworkRequest
        {
            TenantId = tenantId,
            StartNodeId = fromNodeId,
            MaxDepth = (uint)Math.Max(0, maxDepth),
            Direction = direction switch
            {
                "upstream" => TraceDirection.Upstream,
                "downstream" => TraceDirection.Downstream,
                _ => TraceDirection.All,
            },
        };
        return Call(async options =>
        {
            var r = await client.TraceNetworkAsync(request, options);
            return new TraceResult([.. r.NodeIds], [.. r.PipeIds], [.. r.SourceNodeIds], (long)r.GraphVersion, r.GraphReady);
        }, bearer, ct);
    }

    public Task<NearestValvesResult> NearestValvesAsync(string tenantId, string? bearer, string nodeId, int k, CancellationToken ct) =>
        Call(async options =>
        {
            var r = await client.FindNearestValvesAsync(
                new FindNearestValvesRequest { TenantId = tenantId, StartNodeId = nodeId, K = (uint)Math.Max(1, k) }, options);
            return new NearestValvesResult(
                [.. r.Valves.Select(v => new NearestValveResult(v.DeviceId, v.PipeId, (int)v.Distance))],
                (long)r.GraphVersion, r.GraphReady);
        }, bearer, ct);

    public Task<TopologyIssuesResult> IssuesAsync(string tenantId, string? bearer, CancellationToken ct) =>
        Call(async options =>
        {
            var r = await client.ValidateTopologyAsync(new ValidateTopologyRequest { TenantId = tenantId }, options);
            return new TopologyIssuesResult(
                [.. r.Issues.Select(i => new TopologyIssueResult(IssueName(i.Type), [.. i.AssetIds]))],
                (long)r.GraphVersion, r.GraphReady);
        }, bearer, ct);

    private static string IssueName(IssueType type) => type switch
    {
        IssueType.OrphanNode => "orphanNode",
        IssueType.MissingEndpoint => "missingEndpoint",
        IssueType.DisconnectedComponent => "disconnectedComponent",
        _ => "unspecified",
    };

    private static async Task<T> Call<T>(Func<CallOptions, Task<T>> call, string? bearer, CancellationToken ct)
    {
        var headers = new Metadata();
        if (!string.IsNullOrWhiteSpace(bearer)) headers.Add("authorization", $"Bearer {bearer}");
        try
        {
            return await call(new CallOptions(headers, DateTime.UtcNow.Add(Deadline), ct));
        }
        catch (RpcException ex) when (ex.StatusCode != StatusCode.InvalidArgument)
        {
            throw new TopologyUnavailableException($"Topology service unavailable ({ex.StatusCode}).", ex);
        }
    }
}

/// <summary>Used when Downstream:Topology:BaseUrl is not set.</summary>
public sealed class UnconfiguredTopologyClient : ITopologyClient
{
    private static TopologyUnavailableException Fail() => new("Topology service is not configured.");
    public Task<IsolationResult> IsolateAsync(string tenantId, string? bearer, TopologyStart start, CancellationToken ct) => throw Fail();
    public Task<TraceResult> TraceAsync(string tenantId, string? bearer, string fromNodeId, string direction, int maxDepth, CancellationToken ct) => throw Fail();
    public Task<NearestValvesResult> NearestValvesAsync(string tenantId, string? bearer, string nodeId, int k, CancellationToken ct) => throw Fail();
    public Task<TopologyIssuesResult> IssuesAsync(string tenantId, string? bearer, CancellationToken ct) => throw Fail();
}
