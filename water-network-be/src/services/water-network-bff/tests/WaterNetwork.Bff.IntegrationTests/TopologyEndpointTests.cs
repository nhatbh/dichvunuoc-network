using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterNetwork.Bff.Api.Topology;
using WaterPlatform.BuildingBlocks.Security;

namespace WaterNetwork.Bff.IntegrationTests;

/// <summary>/api/gis/topology/* (decision 0029) with a fake topology-rs client.</summary>
public sealed class TopologyEndpointTests
{
    private sealed class FakeTopology : ITopologyClient
    {
        public (string Tenant, string? Bearer, TopologyStart Start)? LastIsolation;
        public bool Down;

        public Task<IsolationResult> IsolateAsync(string tenantId, string? bearer, TopologyStart start, CancellationToken ct)
        {
            if (Down) throw new TopologyUnavailableException("down");
            LastIsolation = (tenantId, bearer, start);
            return Task.FromResult(new IsolationResult(["v1"], ["p1"], ["n1", "n2"], ["p2"], ["svc-1"], 7, true));
        }

        public Task<TraceResult> TraceAsync(string tenantId, string? bearer, string fromNodeId, string direction, int maxDepth, CancellationToken ct) =>
            Task.FromResult(new TraceResult(["n1"], [], direction == "upstream" ? ["R"] : [], 7, true));

        public Task<NearestValvesResult> NearestValvesAsync(string tenantId, string? bearer, string nodeId, int k, CancellationToken ct) =>
            Task.FromResult(new NearestValvesResult([new NearestValveResult("v1", "p1", 0)], 7, true));

        public Task<TopologyIssuesResult> IssuesAsync(string tenantId, string? bearer, CancellationToken ct) =>
            Task.FromResult(new TopologyIssuesResult([new TopologyIssueResult("orphanNode", ["n9"])], 7, true));
    }

    private static (BffApiFactory, HttpClient, string) Setup(FakeTopology fake, params string[] permissions)
    {
        var factory = new BffApiFactory { Topology = fake };
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "u", tenantId: "tenant-1",
            authorizedParty: "water-network-gis-fe",
            permissions: permissions.Length == 0 ? ["network-gis:read"] : permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("X-Tenant-Id", "tenant-1");
        return (factory, client, token);
    }

    [Fact]
    public async Task Isolation_Forwards_Tenant_Bearer_And_Pipe()
    {
        var fake = new FakeTopology();
        var (factory, client, token) = Setup(fake);
        using var _ = factory;

        var resp = await client.PostAsJsonAsync("/api/gis/topology/isolation", new { pipeId = "p1" });

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["valvesToClose"]!.AsArray().Select(v => v!.GetValue<string>()).Should().Equal("v1");
        body["affectedServices"]!.AsArray().Should().HaveCount(1);
        body["graphReady"]!.GetValue<bool>().Should().BeTrue();
        fake.LastIsolation!.Value.Tenant.Should().Be("tenant-1");
        fake.LastIsolation.Value.Bearer.Should().Be(token);
        fake.LastIsolation.Value.Start.Should().Be(new TopologyStart(null, "p1"));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"pipeId\":\"p1\",\"nodeId\":\"n1\"}")]
    public async Task Isolation_Needs_Exactly_One_Start(string json)
    {
        var (factory, client, _) = Setup(new FakeTopology());
        using var __ = factory;
        var resp = await client.PostAsync("/api/gis/topology/isolation",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Topology_Down_Is_503_With_Code()
    {
        var (factory, client, _) = Setup(new FakeTopology { Down = true });
        using var __ = factory;
        var resp = await client.PostAsJsonAsync("/api/gis/topology/isolation", new { nodeId = "n1" });
        resp.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await resp.Content.ReadAsStringAsync()).Should().Contain("TOPOLOGY_UNAVAILABLE");
    }

    [Fact]
    public async Task Trace_Nearest_And_Issues()
    {
        var (factory, client, _) = Setup(new FakeTopology());
        using var __ = factory;
        var up = await client.GetFromJsonAsync<JsonNode>("/api/gis/topology/trace?from=n1&direction=upstream");
        up!["sourceNodeIds"]!.AsArray().Select(v => v!.GetValue<string>()).Should().Equal("R");
        (await client.GetAsync("/api/gis/topology/trace?from=n1&direction=sideways")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var near = await client.GetFromJsonAsync<JsonNode>("/api/gis/topology/nearest-valves?nodeId=n1&k=3");
        near!["valves"]![0]!["deviceId"]!.GetValue<string>().Should().Be("v1");
        var issues = await client.GetFromJsonAsync<JsonNode>("/api/gis/topology/issues");
        issues!["issues"]![0]!["type"]!.GetValue<string>().Should().Be("orphanNode");
    }

    [Fact]
    public async Task Requires_Gis_Read()
    {
        var (factory, client, _) = Setup(new FakeTopology(), "network-asset:read");
        using var __ = factory;
        var resp = await client.GetAsync("/api/gis/topology/issues");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
