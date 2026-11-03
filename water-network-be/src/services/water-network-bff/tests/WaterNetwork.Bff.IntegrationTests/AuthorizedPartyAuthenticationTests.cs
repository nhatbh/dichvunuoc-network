using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class AuthorizedPartyAuthenticationTests
{
    private const string AllowedAuthorizedParty = "water-network-gis-fe";
    private const string Endpoint = "/api/gis/bootstrap";

    [Fact]
    public async Task Missing_Azp_Is_Rejected()
    {
        using var factory = new BffApiFactory();
        using var client = ClientWithToken(factory, DevJwtTokenFactory.CreateToken(
            new JwtOptions(), "user-azp", "tenant-azp", permissions: ["network-gis:read"]));

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Multiple_Azp_Claims_Are_Rejected()
    {
        using var factory = new BffApiFactory();
        var token = DevJwtTokenFactory.CreateTokenWithAuthorizedParties(
            new JwtOptions(),
            "user-azp",
            "tenant-azp",
            [AllowedAuthorizedParty, "another-app"],
            "network-gis:read");
        using var client = ClientWithToken(factory, token);

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Wrong_Azp_Is_Rejected()
    {
        using var factory = new BffApiFactory();
        using var client = ClientWithToken(factory, DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), "user-azp", "tenant-azp",
            authorizedParty: "another-app", permissions: ["network-gis:read"]));

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Exact_Allowed_Azp_Is_Accepted()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets/bootstrap").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200)
                .WithHeader("Content-Type", "application/json")
                .WithBody("{\"schemaVersion\":1,\"hasData\":false}"));
        using var client = ClientWithToken(factory, DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), "user-azp", "tenant-azp",
            authorizedParty: AllowedAuthorizedParty, permissions: ["network-gis:read"]));

        var response = await client.GetAsync(Endpoint);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        factory.Gis.LogEntries.Should().ContainSingle();
    }

    private static HttpClient ClientWithToken(BffApiFactory factory, string token)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
