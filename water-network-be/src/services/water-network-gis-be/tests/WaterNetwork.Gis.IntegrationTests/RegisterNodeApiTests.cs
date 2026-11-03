using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class RegisterNodeApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient CreateAuthenticatedClient(GisApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "test-user", tenantId: "tenant-001",
            authorizedParty: "water-network-gis-fe", permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static object ValidBody(string assetCode) => new
    {
        assetCode, nodeType = "Junction", latitude = 10.762622, longitude = 106.660172
    };

    [Fact]
    public async Task Register_Valid_Node_Returns_201_And_Get_Returns_Node()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var code = $"ND-{Guid.NewGuid():N}"[..16];
        var response = await client.PostAsJsonAsync("/api/network/nodes", ValidBody(code));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        var id = created!["id"];

        var detail = await client.GetAsync($"/api/network/nodes/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await detail.Content.ReadAsStringAsync();
        body.Should().Contain(code);
    }

    [Fact]
    public async Task Duplicate_AssetCode_Returns_409()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var code = $"ND-{Guid.NewGuid():N}"[..16];
        (await client.PostAsJsonAsync("/api/network/nodes", ValidBody(code))).StatusCode.Should().Be(HttpStatusCode.Created);
        (await client.PostAsJsonAsync("/api/network/nodes", ValidBody(code))).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Invalid_Latitude_Returns_400()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/nodes",
            new { assetCode = "ND-INVALID", nodeType = "Junction", latitude = 95.0, longitude = 106.0 });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Missing_Token_Returns_401()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/network/nodes", ValidBody("ND-NOAUTH"));
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Missing_Permission_Returns_403()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:read"); // missing write

        var response = await client.PostAsJsonAsync("/api/network/nodes", ValidBody("ND-NOPERM"));
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Unknown_Node_Returns_404()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:read");

        var response = await client.GetAsync($"/api/network/nodes/node-khong-ton-tai-{Guid.NewGuid():N}");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
