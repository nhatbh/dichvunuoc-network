using Grpc.Core;
using Microsoft.Extensions.Options;
using Waternetwork.Topology.V1;
using WaterNetwork.Incident.Application.Ports;

namespace WaterNetwork.Incident.Infrastructure.Topology;

/// <summary>Real topology adapter — calls topology-rs ComputeIsolationZone over gRPC
/// (decisions 0019/0020/0023). Transport faults become <see cref="TopologyAnalysisException"/>;
/// the handler records an AnalysisFailed plan rather than surfacing the fault.</summary>
public sealed class GrpcTopologyAnalysisAdapter(
    TopologyService.TopologyServiceClient client,
    IOptions<TopologyOptions> options) : ITopologyAnalysisPort
{
    private readonly int _deadlineSeconds = options.Value.DeadlineSeconds;

    public async Task<IsolationZoneResult> ComputeIsolationZoneAsync(
        string tenantId, string startNodeId, CancellationToken ct = default)
    {
        try
        {
            var response = await client.ComputeIsolationZoneAsync(
                new ComputeIsolationZoneRequest { TenantId = tenantId, StartNodeId = startNodeId },
                deadline: DateTime.UtcNow.AddSeconds(_deadlineSeconds), cancellationToken: ct);

            return new IsolationZoneResult(
                response.ValvesToClose.ToList(),
                response.IsolatedNodes.ToList(),
                response.IsolatedPipes.ToList(),
                (long)response.GraphVersion);
        }
        catch (RpcException ex)
        {
            throw new TopologyAnalysisException(
                $"Topology isolation analysis failed ({ex.StatusCode}): {ex.Status.Detail}", ex);
        }
    }
}
