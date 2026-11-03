namespace WaterNetwork.Incident.Application.Ports;

/// <summary>Computes a network isolation zone for an incident's start node via topology-rs
/// (decisions 0019/0020/0023). The Grpc adapter wraps transport faults in
/// <see cref="TopologyAnalysisException"/>; a Stub adapter swaps in for tests via
/// <c>Topology:Provider</c>.</summary>
public interface ITopologyAnalysisPort
{
    Task<IsolationZoneResult> ComputeIsolationZoneAsync(string tenantId, string startNodeId, CancellationToken ct = default);
}

public sealed record IsolationZoneResult(
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    long GraphVersion);

/// <summary>Thrown by the topology port adapter when the analysis cannot be obtained
/// (transport error, deadline exceeded after retries). The handler records an
/// AnalysisFailed plan rather than propagating this to the client (decision 0023 §3).</summary>
public sealed class TopologyAnalysisException(string message, Exception? inner = null)
    : Exception(message, inner);
