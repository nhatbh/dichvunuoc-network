using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignRevisionApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId = "tenant-1")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId,
            permissions: ["network-design:write", "network-design:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> CreateProject(HttpClient client, string name)
    {
        var resp = await client.PostAsJsonAsync("/api/design/projects", new { name });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }

    private static async Task<string> CreateRevision(HttpClient client, string projectId)
    {
        var resp = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }

    private static object NodeBody(string code, string? clientRef = null) => new
    {
        kind = "Node",
        assetCode = code,
        clientRef,
        geometry = new { type = "Point", coordinates = new[] { new[] { 105.8, 21.0 } } },
        attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
    };

    [Fact]
    public async Task Create_Revision_Increments_Number()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "RevProj-" + Guid.CreateVersion7());

        var r1 = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var r2 = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var id2 = (await r2.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{id2}");
        detail!["revisionNumber"]!.GetValue<int>().Should().Be(2);
        detail["status"]!.GetValue<string>().Should().Be("Draft");
    }

    [Fact]
    public async Task Create_Draft_Single_And_Batch_Then_Preview()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "DraftProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);

        var single = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-1", "c1"));
        single.StatusCode.Should().Be(HttpStatusCode.Created);

        var batch = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets:batch",
            new { assets = new[] { NodeBody("N-2", "c2"), NodeBody("N-3", "c3") } });
        batch.StatusCode.Should().Be(HttpStatusCode.Created);

        var preview = await client.GetFromJsonAsync<JsonArray>($"/api/design/revisions/{revisionId}/preview");
        preview!.Count.Should().Be(3);
    }

    [Fact]
    public async Task Validate_Valid_Revision_Returns_Validated()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "ValidProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-1", "c1"));

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        validate.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await validate.Content.ReadFromJsonAsync<JsonNode>();
        result!["isValid"]!.GetValue<bool>().Should().BeTrue();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{revisionId}");
        detail!["status"]!.GetValue<string>().Should().Be("Validated");
    }

    [Fact]
    public async Task Validate_Duplicate_Code_Returns_Errors_And_Stays_Draft()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var projectId = await CreateProject(client, "DupProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("DUP", "c1"));
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("DUP", "c2"));

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        var result = await validate.Content.ReadFromJsonAsync<JsonNode>();
        result!["isValid"]!.GetValue<bool>().Should().BeFalse();
        result["errors"]!.AsArray().Should().Contain(e => e!["code"]!.GetValue<string>() == "DuplicateAssetCode");
    }

    [Fact]
    public async Task Validate_Code_Existing_In_Gis_Is_Error()
    {
        using var factory = new DesignApiFactory(postgis);
        factory.ConfigOverrides["GisLookup:ExistingCodes:0"] = "N-EXIST";
        using var client = Client(factory);
        var projectId = await CreateProject(client, "GisProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(client, projectId);
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-EXIST", "c1"));

        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        var result = await validate.Content.ReadFromJsonAsync<JsonNode>();
        result!["errors"]!.AsArray().Should().Contain(e => e!["code"]!.GetValue<string>() == "AssetCodeExistsInGis");
    }

    [Fact]
    public async Task Tenant_Isolation_Hides_Other_Tenants_Revision()
    {
        using var factory = new DesignApiFactory(postgis);
        using var a = Client(factory, "tenant-A");
        var projectId = await CreateProject(a, "IsoProj-" + Guid.CreateVersion7());
        var revisionId = await CreateRevision(a, projectId);

        using var b = Client(factory, "tenant-B");
        var get = await b.GetAsync($"/api/design/revisions/{revisionId}");
        get.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
