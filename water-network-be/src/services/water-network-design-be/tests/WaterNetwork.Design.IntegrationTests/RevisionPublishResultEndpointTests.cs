using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class RevisionPublishResultEndpointTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId = "tenant-1", bool hasReadPerm = true)
    {
        var perms = hasReadPerm
            ? new[] { "network-design:write", "network-design:read" }
            : new[] { "network-design:write" };
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId, permissions: perms);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task GetPublishResult_Returns200_WithSeededRows()
    {
        using var factory = new DesignApiFactory(postgis);
        var revisionId = "rev-pub-" + Guid.CreateVersion7().ToString("N");
        const string tenantId = "tenant-1";

        // Seed import results directly via the store (no revision lifecycle needed).
        using (var scope = factory.Services.CreateScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IDesignImportResultStore>();
            var rows = new List<ImportResultRow>
            {
                new("draft-a1", "gis-node-1", "imported", null),
                new("draft-a2", null, "failed", "duplicate code")
            };
            await store.SaveResultsAsync(tenantId, revisionId, rows, default);
        }

        using var client = Client(factory, tenantId);
        var response = await client.GetAsync($"/api/design/revisions/{revisionId}/publish-result");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonArray>();
        body.Should().NotBeNull();
        body!.Count.Should().Be(2);
        body.Should().Contain(n => n!["draftAssetId"]!.GetValue<string>() == "draft-a1"
                                   && n["gisAssetId"]!.GetValue<string>() == "gis-node-1"
                                   && n["status"]!.GetValue<string>() == "imported");
        body.Should().Contain(n => n!["draftAssetId"]!.GetValue<string>() == "draft-a2"
                                   && n["status"]!.GetValue<string>() == "failed"
                                   && n["reason"]!.GetValue<string>() == "duplicate code");
    }

    [Fact]
    public async Task GetPublishResult_ReturnsEmptyList_WhenNoResults()
    {
        using var factory = new DesignApiFactory(postgis);
        var revisionId = "rev-empty-" + Guid.CreateVersion7().ToString("N");

        using var client = Client(factory);
        var response = await client.GetAsync($"/api/design/revisions/{revisionId}/publish-result");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonArray>();
        body.Should().NotBeNull();
        body!.Count.Should().Be(0);
    }

    [Fact]
    public async Task GetPublishResult_WithoutReadPermission_IsForbidden()
    {
        using var factory = new DesignApiFactory(postgis);
        var revisionId = "rev-noperm-" + Guid.CreateVersion7().ToString("N");

        using var client = Client(factory, hasReadPerm: false);
        var response = await client.GetAsync($"/api/design/revisions/{revisionId}/publish-result");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
