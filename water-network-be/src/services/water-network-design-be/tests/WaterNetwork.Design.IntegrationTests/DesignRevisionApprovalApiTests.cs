using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignRevisionApprovalApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId = "tenant-1", bool canApprove = true)
    {
        var perms = canApprove
            ? new[] { "network-design:write", "network-design:read", "network-design:approve" }
            : new[] { "network-design:write", "network-design:read" };
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId, permissions: perms);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static object NodeBody(string code) => new
    {
        kind = "Node",
        assetCode = code,
        clientRef = (string?)null,
        geometry = new { type = "Point", coordinates = new[] { new[] { 105.8, 21.0 } } },
        attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
    };

    private static async Task<(string projectId, string revisionId)> ValidatedRevision(HttpClient client)
    {
        var proj = await client.PostAsJsonAsync("/api/design/projects", new { name = "Appr-" + Guid.CreateVersion7() });
        var projectId = (await proj.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var rev = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var revisionId = (await rev.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-1"));
        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        validate.StatusCode.Should().Be(HttpStatusCode.OK);
        return (projectId, revisionId);
    }

    [Fact]
    public async Task Submit_Then_Approve_Happy_Path()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);

        var submit = await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.StatusCode.Should().Be(HttpStatusCode.OK);

        var approve = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/approve", new { reason = "ok" });
        approve.StatusCode.Should().Be(HttpStatusCode.OK);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{revisionId}");
        detail!["status"]!.GetValue<string>().Should().Be("Approved");
        detail["transitions"]!.AsArray().Count.Should().Be(2);
    }

    [Fact]
    public async Task Submit_Then_Reject_Returns_To_Draft_With_Reason()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);
        await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        var reject = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/reject", new { reason = "missing elevation" });
        reject.StatusCode.Should().Be(HttpStatusCode.OK);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{revisionId}");
        detail!["status"]!.GetValue<string>().Should().Be("Draft");
        detail["transitions"]!.AsArray().Should()
            .Contain(t => t!["toStatus"]!.GetValue<string>() == "Draft" && t["reason"]!.GetValue<string>() == "missing elevation");
    }

    [Fact]
    public async Task Submit_From_Draft_Is_Unprocessable()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var proj = await client.PostAsJsonAsync("/api/design/projects", new { name = "Draft-" + Guid.CreateVersion7() });
        var projectId = (await proj.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var rev = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var revisionId = (await rev.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var submit = await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Approve_Without_Permission_Is_Forbidden()
    {
        using var factory = new DesignApiFactory(postgis);
        using var writer = Client(factory, canApprove: true);
        var (_, revisionId) = await ValidatedRevision(writer);
        await writer.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        using var noApprove = Client(factory, canApprove: false);
        var approve = await noApprove.PostAsJsonAsync($"/api/design/revisions/{revisionId}/approve", new { reason = "x" });
        approve.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Reject_Without_Reason_Is_BadRequest()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);
        await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        var reject = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/reject", new { reason = "" });
        reject.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Submit_Cross_Tenant_Is_NotFound()
    {
        using var factory = new DesignApiFactory(postgis);
        using var a = Client(factory, "tenant-A");
        var (_, revisionId) = await ValidatedRevision(a);

        using var b = Client(factory, "tenant-B");
        var submit = await b.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Draft_Mutation_Blocked_After_Submit()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);
        await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        var addDraft = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-2"));
        addDraft.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }
}
