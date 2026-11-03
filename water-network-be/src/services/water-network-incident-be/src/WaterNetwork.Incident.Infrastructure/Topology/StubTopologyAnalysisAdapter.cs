using WaterNetwork.Incident.Application.Ports;

namespace WaterNetwork.Incident.Infrastructure.Topology;

/// <summary>Config-swapped test/dev adapter (Topology:Provider=Stub). Returns a fixed
/// isolation zone; the sentinel start node "__fail__" simulates a topology outage.</summary>
public sealed class StubTopologyAnalysisAdapter : ITopologyAnalysisPort
{
    public Task<IsolationZoneResult> ComputeIsolationZoneAsync(string tenantId, string startNodeId, CancellationToken ct = default)
    {
        if (startNodeId == "__fail__")
            throw new TopologyAnalysisException("stub: simulated topology outage");

        return Task.FromResult(new IsolationZoneResult(
            ValvesToClose: ["valve-stub-1"],
            IsolatedNodes: [startNodeId],
            IsolatedPipes: ["pipe-stub-1"],
            GraphVersion: 42));
    }
}
