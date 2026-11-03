using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

[Collection("incident-postgis")]
public sealed class IncidentIsolationApiTests(PostgisFixture postgis)
{
    private static IncidentApiFactory StubFactory(PostgisFixture pg)
    {
        var f = new IncidentApiFactory(pg);
        f.ConfigOverrides["Topology:Provider"] = "Stub";
        return f;
    }

    private static HttpClient Client(IncidentApiFactory factory, string tenantId = "tenant-1")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "operator-1", tenantId: tenantId,
            permissions: ["network-incident:write", "network-incident:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> ReportAndClassify(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "PipeBurst",
            severity = 3,
            affectedRefs = new[] { new { assetId = "node-1", kind = "Node" } }
        });
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        await client.PostAsJsonAsync($"/api/incidents/{id}/classify", new { category = "PipeBurst", severity = 3, note = (string?)null });
        return id;
    }

    [Fact]
    public async Task Analysis_Success_Returns_Plan_And_Sets_Ready()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var id = await ReportAndClassify(client);

        var resp = await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = (await resp.Content.ReadFromJsonAsync<JsonNode>())!;
        body["status"]!.GetValue<string>().Should().Be("Proposed");
        body["incidentStatus"]!.GetValue<string>().Should().Be("IsolationPlanReady");
        body["valvesToClose"]!.AsArray().Should().ContainSingle();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("IsolationPlanReady");
        detail["isolationPlans"]!.AsArray().Should().ContainSingle();
    }

    [Fact]
    public async Task Analysis_Topology_Failure_Returns_AnalysisFailed_Retryable()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var id = await ReportAndClassify(client);

        var resp = await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "__fail__" });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = (await resp.Content.ReadFromJsonAsync<JsonNode>())!;
        body["status"]!.GetValue<string>().Should().Be("AnalysisFailed");
        body["incidentStatus"]!.GetValue<string>().Should().Be("IsolationRequested");

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("IsolationRequested");
    }

    [Fact]
    public async Task Analysis_On_Reported_Incident_Returns_422()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var resp0 = await client.PostAsJsonAsync("/api/incidents", new { category = "Leak", severity = 2 });
        var id = (await resp0.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var resp = await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Analysis_On_Other_Tenants_Incident_Returns_404()
    {
        using var factory = StubFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");
        var id = await ReportAndClassify(t1);

        var resp = await t2.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" });
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
