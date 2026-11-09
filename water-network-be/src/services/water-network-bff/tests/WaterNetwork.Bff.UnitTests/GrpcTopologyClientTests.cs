using FluentAssertions;
using Grpc.Core;
using Waternetwork.Topology.V1;
using WaterNetwork.Bff.Api.Topology;

namespace WaterNetwork.Bff.UnitTests;

public sealed class GrpcTopologyClientTests
{
    private sealed class FakeClient : TopologyService.TopologyServiceClient
    {
        public ComputeIsolationZoneRequest? Isolation;
        public TraceNetworkRequest? Trace;
        public Metadata? Headers;
        public StatusCode? Fail;

        private AsyncUnaryCall<T> Reply<T>(T response, CallOptions options)
        {
            Headers = options.Headers;
            if (Fail is { } code) throw new RpcException(new Status(code, "boom"));
            return new AsyncUnaryCall<T>(Task.FromResult(response), Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess, () => [], () => { });
        }

        public override AsyncUnaryCall<ComputeIsolationZoneResponse> ComputeIsolationZoneAsync(ComputeIsolationZoneRequest request, CallOptions options)
        {
            Isolation = request;
            return Reply(new ComputeIsolationZoneResponse
            {
                ValvesToClose = { "v1" }, IsolatedPipes = { "p1" }, IsolatedNodes = { "n1" },
                BoundaryPipeIds = { "p2" }, AffectedServiceIds = { "s1" }, GraphVersion = 9, GraphReady = true,
            }, options);
        }

        public override AsyncUnaryCall<TraceNetworkResponse> TraceNetworkAsync(TraceNetworkRequest request, CallOptions options)
        {
            Trace = request;
            return Reply(new TraceNetworkResponse { NodeIds = { "n1" }, SourceNodeIds = { "R" }, GraphReady = true }, options);
        }
    }

    [Fact]
    public async Task Isolation_From_A_Pipe_Forwards_The_Bearer_And_Maps_The_Zone()
    {
        var fake = new FakeClient();
        var r = await new GrpcTopologyClient(fake).IsolateAsync("t1", "tok", new TopologyStart(null, "p1"), default);

        fake.Isolation!.StartPipeId.Should().Be("p1");
        fake.Isolation.TenantId.Should().Be("t1");
        fake.Headers!.GetValue("authorization").Should().Be("Bearer tok");
        r.Should().BeEquivalentTo(new IsolationResult(["v1"], ["p1"], ["n1"], ["p2"], ["s1"], 9, true));
    }

    [Theory]
    [InlineData("upstream", TraceDirection.Upstream)]
    [InlineData("downstream", TraceDirection.Downstream)]
    [InlineData("all", TraceDirection.All)]
    public async Task Trace_Direction_Is_Mapped(string direction, TraceDirection expected)
    {
        var fake = new FakeClient();
        var r = await new GrpcTopologyClient(fake).TraceAsync("t1", null, "n1", direction, 0, default);
        fake.Trace!.Direction.Should().Be(expected);
        fake.Headers!.Should().BeEmpty();
        r.SourceNodeIds.Should().Equal("R");
    }

    [Fact]
    public async Task Transport_Faults_Become_Unavailable()
    {
        var client = new GrpcTopologyClient(new FakeClient { Fail = StatusCode.Unavailable });
        var act = () => client.IsolateAsync("t1", null, new TopologyStart("n1", null), default);
        await act.Should().ThrowAsync<TopologyUnavailableException>();
    }

    [Fact]
    public async Task Unconfigured_Client_Is_Unavailable()
    {
        var act = () => new UnconfiguredTopologyClient().IssuesAsync("t1", null, default);
        await act.Should().ThrowAsync<TopologyUnavailableException>();
    }
}
