using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

[Collection("incident-postgis")]
public sealed class IncidentLifecycleApiTests(PostgisFixture postgis)
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
            permissions: ["network-incident:write", "network-incident:read", "network-incident:confirm"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> ReportClassifyAnalyse(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "PipeBurst",
            severity = 3,
            affectedRefs = new[] { new { assetId = "node-1", kind = "Node" } }
        });
        resp.EnsureSuccessStatusCode();
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        (await client.PostAsJsonAsync($"/api/incidents/{id}/classify", new { category = "PipeBurst", severity = 3, note = (string?)null }))
            .EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" }))
            .EnsureSuccessStatusCode();
        return id;
    }

    [Fact]
    public async Task Confirm_Start_Resolve_Walks_Incident_To_Resolved()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var id = await ReportClassifyAnalyse(client);

        (await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-plan/confirm", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.PostAsJsonAsync($"/api/incidents/{id}/start-handling", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.PostAsJsonAsync($"/api/incidents/{id}/resolve", new { resolutionNote = "fixed" }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Resolved");
        detail["isolationPlans"]!.AsArray()[0]!["status"]!.GetValue<string>().Should().Be("Confirmed");
    }

    [Fact]
    public async Task Confirm_From_Classified_NoPlan_Returns_422()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        // report + classify only -> status Classified, no plan
        var resp0 = await client.PostAsJsonAsync("/api/incidents", new { category = "Leak", severity = 2 });
        var id = (await resp0.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        await client.PostAsJsonAsync($"/api/incidents/{id}/classify", new { category = "Leak", severity = 2, note = (string?)null });

        (await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-plan/confirm", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Confirm_CrossTenant_Returns_404()
    {
        using var factory = StubFactory(postgis);
        using var owner = Client(factory, "tenant-1");
        using var attacker = Client(factory, "tenant-2");
        var id = await ReportClassifyAnalyse(owner);

        (await attacker.PostAsJsonAsync($"/api/incidents/{id}/isolation-plan/confirm", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
