using FluentAssertions;
using Grpc.Net.Client;
using Microsoft.Extensions.Options;
using Waternetwork.Topology.V1;
using WaterNetwork.Incident.Infrastructure.Topology;

namespace WaterNetwork.Incident.IntegrationTests;

// Joins the "incident-postgis" collection so the heavy image-build/tar of the git-root
// build context runs serially with the API tests rather than in parallel with them —
// concurrent tar staging of the large context races and intermittently loses the temp
// archive (FileNotFoundException on the dockerfile .tar). It does not use the postgis
// fixture; collection membership is only for serialization.
[Collection("incident-postgis")]
public sealed class TopologyGrpcContractTests(TopologyContainerFixture topology) : IClassFixture<TopologyContainerFixture>
{
    [Fact]
    public async Task ComputeIsolationZone_Unknown_Tenant_Returns_WellFormed_Empty_Response()
    {
        using var channel = GrpcChannel.ForAddress(topology.GrpcAddress);
        var client = new TopologyService.TopologyServiceClient(channel);
        var adapter = new GrpcTopologyAnalysisAdapter(client, Options.Create(new TopologyOptions { DeadlineSeconds = 5 }));

        var result = await adapter.ComputeIsolationZoneAsync("tenant-unknown", "node-unknown", default);

        // Decision 0020 §5: unknown tenant/start node → empty lists, no error.
        result.ValvesToClose.Should().BeEmpty();
        result.IsolatedNodes.Should().BeEmpty();
        result.IsolatedPipes.Should().BeEmpty();
        result.GraphVersion.Should().BeGreaterThanOrEqualTo(0);
    }
}
