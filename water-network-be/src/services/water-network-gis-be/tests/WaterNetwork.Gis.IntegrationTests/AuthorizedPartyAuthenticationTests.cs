using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Gis.IntegrationTests;

public sealed class AuthorizedPartyAuthenticationTests(PostgisFixture postgis)
    : IClassFixture<PostgisFixture>
{
    private const string AllowedAuthorizedParty = "water-network-gis-fe";
    private const string Endpoint = "/api/network/assets/bootstrap";

    [Fact]
    public async Task Missing_Azp_Is_Rejected()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = ClientWithToken(factory, DevJwtTokenFactory.CreateToken(
            new JwtOptions(), "user-azp", "tenant-azp", permissions: ["network-gis:read"]));

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Multiple_Azp_Claims_Are_Rejected()
    {
        await using var factory = new GisApiFactory(postgis);
        var token = DevJwtTokenFactory.CreateTokenWithAuthorizedParties(
            new JwtOptions(),
            "user-azp",
            "tenant-azp",
            [AllowedAuthorizedParty, "another-app"],
            "network-gis:read");
        using var client = ClientWithToken(factory, token);

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Wrong_Azp_Is_Rejected()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = ClientWithToken(factory, DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), "user-azp", "tenant-azp",
            authorizedParty: "another-app", permissions: ["network-gis:read"]));

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Exact_Allowed_Azp_Is_Accepted()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = ClientWithToken(factory, DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), "user-azp", "tenant-azp",
            authorizedParty: AllowedAuthorizedParty, permissions: ["network-gis:read"]));

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private static HttpClient ClientWithToken(GisApiFactory factory, string token)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
