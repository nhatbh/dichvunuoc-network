using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class ExportAssetsApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient Client(GisApiFactory factory, string tenantId, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "u", tenantId: tenantId,
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
    public async Task Keyset_Pagination_Walks_All_Pages()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenantId = $"tenant-export-{Guid.NewGuid():N}"[..24];
        var writer = Client(factory, tenantId, "network-gis:write", "network-gis:read");

        // Seed at least 2 assets for this tenant.
        await SeedNode(writer, 10.765, 106.66);
        await SeedNode(writer, 10.766, 106.661);

        // First page: limit=1 -> 1 item + non-null nextCursor.
        var page1 = await GetPage(writer, cursor: null, limit: 1);
        page1.GetProperty("items").GetArrayLength().Should().Be(1);
        var cursor1 = page1.GetProperty("nextCursor");
        cursor1.ValueKind.Should().Be(JsonValueKind.String);
        var firstId = page1.GetProperty("items")[0].GetProperty("id").GetString();

        // Second page: ?cursor=<that> -> the next item, different from the first.
        var page2 = await GetPage(writer, cursor: cursor1.GetString(), limit: 1);
        page2.GetProperty("items").GetArrayLength().Should().Be(1);
        var secondId = page2.GetProperty("items")[0].GetProperty("id").GetString();
        secondId.Should().NotBe(firstId);

        // Final page: walk until nextCursor is null; the last page returns null.
        var cursor = page2.GetProperty("nextCursor");
        var current = page2;
        var guard = 0;
        while (current.GetProperty("nextCursor").ValueKind == JsonValueKind.String && guard++ < 100)
        {
            current = await GetPage(writer, cursor: current.GetProperty("nextCursor").GetString(), limit: 1);
        }
        current.GetProperty("nextCursor").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Export_Returns_Minimal_Node_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenantId = $"tenant-export-{Guid.NewGuid():N}"[..24];
        var writer = Client(factory, tenantId, "network-gis:write", "network-gis:read");
        await SeedNode(writer, 10.765, 106.66);

        var page = await GetPage(writer, cursor: null, limit: 1000);
        page.GetProperty("items").GetArrayLength().Should().BeGreaterThan(0);
        var item = page.GetProperty("items")[0];
        item.GetProperty("kind").GetString().Should().Be("Node");
        item.GetProperty("nodeType").GetString().Should().Be("Junction");
        item.GetProperty("id").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task Missing_Permission_Returns_403()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "tenant-export-noperm", "network-gis:write"); // no read
        var resp = await client.GetAsync("/api/network/assets/export?limit=1");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = factory.CreateClient();
        var resp = await client.GetAsync("/api/network/assets/export?limit=1");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    private static async Task<JsonElement> GetPage(HttpClient c, string? cursor, int limit)
    {
        var url = cursor is null
            ? $"/api/network/assets/export?limit={limit}"
            : $"/api/network/assets/export?limit={limit}&cursor={Uri.EscapeDataString(cursor)}";
        var resp = await c.GetAsync(url);
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }
}
