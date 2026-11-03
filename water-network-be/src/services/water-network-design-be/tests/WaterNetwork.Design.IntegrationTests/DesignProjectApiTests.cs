using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignProjectApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId = "tenant-1", params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId, permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Create_Then_Get_Returns_Project()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write", "network-design:read");

        var create = await client.PostAsJsonAsync("/api/design/projects", new { name = "Plan A", branchId = "b1", zoneId = "z2" });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await create.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var get = await client.GetAsync($"/api/design/projects/{id}");
        get.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await get.Content.ReadFromJsonAsync<JsonNode>();
        body!["name"]!.GetValue<string>().Should().Be("Plan A");
        body["status"]!.GetValue<string>().Should().Be("Open");
        body["branchId"]!.GetValue<string>().Should().Be("b1");
    }

    [Fact]
    public async Task Create_Missing_Name_Returns_400()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");

        var resp = await client.PostAsJsonAsync("/api/design/projects", new { name = "" });
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Duplicate_Name_In_Tenant_Returns_409()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-dup", "network-design:write");

        await client.PostAsJsonAsync("/api/design/projects", new { name = "Dupe" });
        var second = await client.PostAsJsonAsync("/api/design/projects", new { name = "Dupe" });
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Tenant_Isolation_Hides_Other_Tenants_Project()
    {
        using var factory = new DesignApiFactory(postgis);
        using var a = Client(factory, "tenant-A", "network-design:write", "network-design:read");
        var create = await a.PostAsJsonAsync("/api/design/projects", new { name = "ASecret" });
        var id = (await create.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        using var b = Client(factory, "tenant-B", "network-design:read");
        var get = await b.GetAsync($"/api/design/projects/{id}");
        get.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = factory.CreateClient();
        var resp = await client.GetAsync("/api/design/projects/whatever");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
