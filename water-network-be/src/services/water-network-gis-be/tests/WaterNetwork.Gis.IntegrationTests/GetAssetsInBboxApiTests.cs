using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class GetAssetsInBboxApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private const string InsideBbox = "106.65,10.76,106.67,10.77";

    private static HttpClient Client(GisApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "u", tenantId: "tenant-api",
            authorizedParty: "water-network-gis-fe", permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task SeedNode(HttpClient c, double lat, double lng)
    {
        var resp = await c.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = lat, longitude = lng
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Returns_FeatureCollection_With_Seeded_Node()
    {
        await using var factory = new GisApiFactory(postgis);
        var writer = Client(factory, "network-gis:write", "network-gis:read");
        await SeedNode(writer, 10.765, 106.66);

        var resp = await writer.GetAsync($"/api/network/assets?bbox={InsideBbox}&types=node");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("type").GetString().Should().Be("FeatureCollection");
        json.GetProperty("features").GetArrayLength().Should().BeGreaterThan(0);
        json.GetProperty("truncated").GetBoolean().Should().BeFalse();

        var feature = json.GetProperty("features")[0];
        feature.GetProperty("type").GetString().Should().Be("Feature");
        feature.GetProperty("geometry").GetProperty("type").GetString().Should().Be("Point");
        feature.GetProperty("properties").GetProperty("kind").GetString().Should().Be("Node");
        feature.GetProperty("properties").GetProperty("lifecycleStatus").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Feature_LifecycleStatus_Is_Populated_From_Projection()
    {
        await using var factory = new GisApiFactory(postgis);
        var writer = Client(factory, "network-gis:write", "network-gis:read");

        var resp = await writer.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = 10.765, longitude = 106.66
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var nodeId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

        using (var scope = factory.Services.CreateScope())
        {
            var store = scope.ServiceProvider
                .GetRequiredService<WaterNetwork.Gis.Application.Ports.IAssetStateProjectionStore>();
            await store.UpsertAsync(nodeId, "tenant-api", "Suspended",
                new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc), "evt-1");
        }

        var json = await (await writer.GetAsync($"/api/network/assets?bbox={InsideBbox}&types=node"))
            .Content.ReadFromJsonAsync<JsonElement>();

        var feature = json.GetProperty("features").EnumerateArray()
            .First(x => x.GetProperty("id").GetString() == nodeId);
        feature.GetProperty("properties").GetProperty("lifecycleStatus").GetString().Should().Be("Suspended");
    }

    [Fact]
    public async Task Bbox_Area_Too_Large_Returns_400()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "network-gis:read");
        var resp = await client.GetAsync("/api/network/assets?bbox=100.0,10.0,102.0,12.0");
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Inverted_Bbox_Returns_400()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "network-gis:read");
        var resp = await client.GetAsync("/api/network/assets?bbox=106.7,10.7,106.6,10.8");
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Missing_Permission_Returns_403()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "network-gis:write"); // no read
        var resp = await client.GetAsync($"/api/network/assets?bbox={InsideBbox}");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = factory.CreateClient();
        var resp = await client.GetAsync($"/api/network/assets?bbox={InsideBbox}");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Tenant_Isolation_Other_Tenant_Sees_Nothing()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenantA = Client(factory, "network-gis:write", "network-gis:read"); // tenant-api
        await SeedNode(tenantA, 10.765, 106.66);

        var other = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "u2", tenantId: "tenant-other",
            authorizedParty: "water-network-gis-fe", permissions: ["network-gis:read"]);
        other.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await other.GetAsync($"/api/network/assets?bbox={InsideBbox}&types=node");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("features").GetArrayLength().Should().Be(0);
    }
}
