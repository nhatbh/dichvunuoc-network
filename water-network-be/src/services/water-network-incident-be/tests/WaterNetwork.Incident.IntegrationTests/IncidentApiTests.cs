using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

[Collection("incident-postgis")]
public sealed class IncidentApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(IncidentApiFactory factory, string tenantId = "tenant-1")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "operator-1", tenantId: tenantId,
            permissions: ["network-incident:write", "network-incident:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static IncidentApiFactory NewFactory(PostgisFixture pg, params string[] existingRefs)
    {
        var f = new IncidentApiFactory(pg);
        for (var i = 0; i < existingRefs.Length; i++)
            f.ConfigOverrides[$"GisLookup:ExistingRefs:{i}"] = existingRefs[i];
        return f;
    }

    [Fact]
    public async Task Report_Then_Get_Detail_Returns_Reported_Incident()
    {
        using var factory = NewFactory(postgis, "Pipe:pipe-1");
        using var client = Client(factory);

        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "PipeBurst",
            severity = 3,
            longitude = 106.7,
            latitude = 10.8,
            affectedRefs = new[] { new { assetId = "pipe-1", kind = "Pipe" } }
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Reported");
        detail["severity"]!.GetValue<int>().Should().Be(3);
        detail["affectedRefs"]!.AsArray().Should().ContainSingle();
        detail["affectedRefs"]![0]!["verified"]!.GetValue<bool>().Should().BeTrue();
        detail["timeline"]!.AsArray().Should().ContainSingle();
    }

    [Fact]
    public async Task Report_With_Unknown_Ref_Stores_It_Unverified()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);

        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "Leak",
            severity = 2,
            affectedRefs = new[] { new { assetId = "ghost", kind = "Node" } }
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["affectedRefs"]![0]!["verified"]!.GetValue<bool>().Should().BeFalse();
    }

    [Fact]
    public async Task Report_With_Invalid_Severity_Returns_400()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);
        var resp = await client.PostAsJsonAsync("/api/incidents", new { category = "Other", severity = 9 });
        // ValidationEndpointFilter returns HTTP 400 (not 422) — confirmed from ValidationEndpointFilter.cs
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Classify_Moves_Status_And_Appends_Timeline()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);
        var id = await Report(client);

        var classify = await client.PostAsJsonAsync($"/api/incidents/{id}/classify",
            new { category = "WaterLoss", severity = 4, note = "field-assessed" });
        classify.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Classified");
        detail["category"]!.GetValue<string>().Should().Be("WaterLoss");
        detail["timeline"]!.AsArray().Count.Should().Be(2);
    }

    [Fact]
    public async Task Cancel_Moves_To_Cancelled()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);
        var id = await Report(client);

        var cancel = await client.PostAsJsonAsync($"/api/incidents/{id}/cancel", new { reason = "duplicate" });
        cancel.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Cancelled");
        detail["cancellationReason"]!.GetValue<string>().Should().Be("duplicate");
    }

    [Fact]
    public async Task List_Filters_By_Status_And_Is_Tenant_Scoped()
    {
        // Use unique tenant IDs per test run so parallel/sequential test runs don't pollute each other
        var tid1 = "list-t1-" + Guid.NewGuid().ToString("N");
        var tid2 = "list-t2-" + Guid.NewGuid().ToString("N");
        using var factory = NewFactory(postgis);
        using var t1 = Client(factory, tid1);
        using var t2 = Client(factory, tid2);
        await Report(t1);
        await Report(t2);
        var t1List = (await t1.GetFromJsonAsync<JsonNode>("/api/incidents?status=Reported"))!.AsArray();
        t1List.Count.Should().Be(1);
    }

    [Fact]
    public async Task Get_Other_Tenants_Incident_Returns_404()
    {
        using var factory = NewFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");
        var id = await Report(t1);
        var resp = await t2.GetAsync($"/api/incidents/{id}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Classify_Other_Tenants_Incident_Returns_404()
    {
        using var factory = NewFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");
        var id = await Report(t1);
        var resp = await t2.PostAsJsonAsync($"/api/incidents/{id}/classify",
            new { category = "Other", severity = 1, note = (string?)null });
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Cancel_Other_Tenants_Incident_Returns_404()
    {
        using var factory = NewFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");
        var id = await Report(t1);
        var resp = await t2.PostAsJsonAsync($"/api/incidents/{id}/cancel", new { reason = "x" });
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Detail_Exposes_Isolation_Plans_From_Read_Path()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory, "tenant-detail");

        string incidentId;
        using (var scope = factory.Services.CreateScope())
        {
            var repo = scope.ServiceProvider
                .GetRequiredService<WaterNetwork.Incident.Domain.Repositories.INetworkIncidentRepository>();
            var incident = WaterNetwork.Incident.Domain.Aggregates.NetworkIncident.Report(
                "tenant-detail", WaterNetwork.Incident.Domain.ValueObjects.IncidentCategory.PipeBurst, 3, 1, 1,
                [WaterNetwork.Incident.Domain.ValueObjects.AssetRef.Create("node-1",
                    WaterNetwork.Incident.Domain.ValueObjects.AssetRefKind.Node, true)], "operator-1");
            incident.Classify(WaterNetwork.Incident.Domain.ValueObjects.IncidentCategory.PipeBurst, 3, "operator-1", null);
            incident.RequestIsolationAnalysis("node-1", "operator-1");
            incident.RecordIsolationPlan(7, ["v1", "v2"], ["node-1"], ["p1"], "operator-1");
            await repo.SaveAsync(incident, default);
            incidentId = incident.Id;
        }

        var detail = await client.GetFromJsonAsync<System.Text.Json.Nodes.JsonNode>($"/api/incidents/{incidentId}");
        var plans = detail!["isolationPlans"]!.AsArray();
        plans.Should().ContainSingle();
        plans[0]!["status"]!.GetValue<string>().Should().Be("Proposed");
        plans[0]!["graphVersion"]!.GetValue<long>().Should().Be(7);
        plans[0]!["valvesToClose"]!.AsArray().Select(n => n!.GetValue<string>()).Should().Equal("v1", "v2");
    }

    [Fact]
    public async Task Detail_Has_Empty_IsolationPlans_When_None()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);
        var id = await Report(client);

        var detail = await client.GetFromJsonAsync<System.Text.Json.Nodes.JsonNode>($"/api/incidents/{id}");
        detail!["isolationPlans"]!.AsArray().Should().BeEmpty();
    }

    private static async Task<string> Report(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/incidents", new { category = "PipeBurst", severity = 3 });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }
}
