using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class MapEndpointTests
{
    private static HttpClient AuthedClient(BffApiFactory factory)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "u", tenantId: "tenant-1",
            authorizedParty: "water-network-gis-fe", permissions: ["network-gis:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Passthrough_Returns_Bbox_Body()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200)
                .WithHeader("Content-Type", "application/json")
                .WithBody("[{\"id\":\"n1\",\"lifecycleStatus\":\"Active\"}]"));
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/map?bbox=1,2,3,4&types=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!.AsArray().Should().HaveCount(1);
        body[0]!["lifecycleStatus"]!.GetValue<string>().Should().Be("Active");
    }

    [Fact]
    public async Task Public_Gis_Alias_Uses_The_Canonical_Map_Handler()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200)
                .WithHeader("Content-Type", "application/json")
                .WithBody("{\"type\":\"FeatureCollection\",\"features\":[],\"truncated\":false}"));
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/api/gis/map?bbox=1,2,3,4");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["type"]!.GetValue<string>().Should().Be("FeatureCollection");
    }

    [Theory]
    [InlineData("/api/gis/bootstrap")]
    [InlineData("/bff/water-network/map/bootstrap")]
    public async Task Bootstrap_Aliases_Pass_Through_Canonical_Gis_Response(string path)
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets/bootstrap").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200)
                .WithHeader("Content-Type", "application/json")
                .WithBody("{\"schemaVersion\":1,\"hasData\":false,\"homeView\":null," +
                          "\"counts\":{\"nodes\":0,\"pipes\":0,\"devices\":0,\"total\":0}," +
                          "\"pipeLengthM\":0,\"materialMix\":[],\"statusMix\":[]}"));
        using var client = AuthedClient(factory);

        var response = await client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonNode>();
        body!["schemaVersion"]!.GetValue<int>().Should().Be(1);
        body["counts"]!["total"]!.GetValue<long>().Should().Be(0);
    }

    [Fact]
    public async Task Bootstrap_Gis_Down_Returns_502()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets/bootstrap").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(500));
        using var client = AuthedClient(factory);

        var response = await client.GetAsync("/api/gis/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.BadGateway);
    }

    [Fact]
    public async Task Bootstrap_Forwards_Bearer_To_Gis()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets/bootstrap").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200)
                .WithHeader("Content-Type", "application/json")
                .WithBody("{\"schemaVersion\":1,\"hasData\":false}"));
        using var client = AuthedClient(factory);

        await client.GetAsync("/bff/water-network/map/bootstrap");

        factory.Gis.LogEntries.Should().ContainSingle();
        var request = factory.Gis.LogEntries.Single().RequestMessage!;
        request.Headers!.Should().ContainKey("Authorization");
        request.Headers!["Authorization"].Single().Should().StartWith("Bearer ");
    }

    [Fact]
    public async Task Bootstrap_No_Token_Returns_401_Without_Calling_Gis()
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/gis/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Gis_Down_Returns_502()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(500));
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/map?bbox=1,2,3,4");

        resp.StatusCode.Should().Be(HttpStatusCode.BadGateway);
    }

    [Fact]
    public async Task Gis_Returns_400_Forwards_400()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(400)
                .WithHeader("Content-Type", "application/json")
                .WithBody("{\"error\":\"invalid bbox\"}"));
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/map?bbox=bad");

        // GIS validation errors propagate verbatim (status + body), not as 502.
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["error"]!.GetValue<string>().Should().Be("invalid bbox");
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var resp = await client.GetAsync("/bff/water-network/map?bbox=1,2,3,4");

        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
