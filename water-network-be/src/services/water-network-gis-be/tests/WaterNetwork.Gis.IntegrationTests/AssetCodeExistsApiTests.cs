using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Responses;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Gis.IntegrationTests;

public sealed class AssetCodeExistsApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task Returns_True_For_The_Caller_Tenant_And_False_For_Another_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenantA = Client(factory, "tenant-exists-a", "network-gis:write", "network-gis:read");
        var tenantB = Client(factory, "tenant-exists-b", "network-gis:read");
        var assetCode = $"ND-{Guid.NewGuid():N}"[..16];

        var created = await tenantA.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode,
            nodeType = "Junction",
            latitude = 10.762622,
            longitude = 106.660172
        });
        created.StatusCode.Should().Be(HttpStatusCode.Created);

        var ownResult = await tenantA.GetFromJsonAsync<AssetCodeExistsResponse>(
            $"/api/network/assets/exists?assetCode={Uri.EscapeDataString(assetCode)}");
        var otherResult = await tenantB.GetFromJsonAsync<AssetCodeExistsResponse>(
            $"/api/network/assets/exists?assetCode={Uri.EscapeDataString(assetCode)}");

        ownResult!.Exists.Should().BeTrue();
        otherResult!.Exists.Should().BeFalse();
    }

    [Fact]
    public async Task Rejects_A_Missing_Asset_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "tenant-exists", "network-gis:read");

        var response = await client.GetAsync("/api/network/assets/exists");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Requires_Read_Permission()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = Client(factory, "tenant-exists", "network-gis:write");

        var response = await client.GetAsync("/api/network/assets/exists?assetCode=ND-1");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    private static HttpClient Client(
        GisApiFactory factory,
        string tenantId,
        params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(),
            subject: "asset-exists-user",
            tenantId: tenantId,
            authorizedParty: "water-network-gis-fe",
            permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
