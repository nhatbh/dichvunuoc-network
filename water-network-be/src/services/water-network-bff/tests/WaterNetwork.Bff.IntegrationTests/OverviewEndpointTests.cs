using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class OverviewEndpointTests
{
    private static HttpClient AuthedClient(BffApiFactory factory)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "u", tenantId: "tenant-1",
            authorizedParty: "water-network-gis-fe",
            permissions: ["network-gis:read", "network-asset:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("X-Tenant-Id", "tenant-1");
        return client;
    }

    private static void StubGisNode(BffApiFactory f, string id, HttpStatusCode status, string? body = null) =>
        f.Gis.Given(Request.Create().WithPath($"/api/network/nodes/{id}").UsingGet())
            .RespondWith(Response.Create().WithStatusCode((int)status)
                .WithHeader("Content-Type", "application/json").WithBody(body ?? "{}"));

    private static void StubAsset(BffApiFactory f, string id, HttpStatusCode status, string? body = null) =>
        f.Asset.Given(Request.Create().WithPath($"/api/assets/{id}").UsingGet())
            .RespondWith(Response.Create().WithStatusCode((int)status)
                .WithHeader("Content-Type", "application/json").WithBody(body ?? "{}"));

    [Fact]
    public async Task Both_Ok_Returns_Full_Overview()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\",\"assetCode\":\"N-1\",\"nodeType\":\"Junction\"}");
        StubAsset(factory, "n1", HttpStatusCode.OK,
            "{\"id\":\"n1\",\"assetCode\":\"N-1\",\"status\":\"Active\",\"technicalProfile\":{\"manufacturer\":\"Acme\"}}");
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["assetId"]!.GetValue<string>().Should().Be("n1");
        body["type"]!.GetValue<string>().Should().Be("node");
        body["gis"]!["nodeType"]!.GetValue<string>().Should().Be("Junction");
        body["lifecycle"]!["status"]!.GetValue<string>().Should().Be("Active");
        body["sources"]!["gis"]!.GetValue<string>().Should().Be("ok");
        body["sources"]!["asset"]!.GetValue<string>().Should().Be("ok");
    }

    [Fact]
    public async Task Asset_Down_Degrades_To_Null_Lifecycle()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\"}");
        StubAsset(factory, "n1", HttpStatusCode.InternalServerError);
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["lifecycle"].Should().BeNull();
        body["sources"]!["asset"]!.GetValue<string>().Should().Be("unavailable");
    }

    [Fact]
    public async Task Asset_404_Degrades_To_Null_Lifecycle()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\"}");
        StubAsset(factory, "n1", HttpStatusCode.NotFound);
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["lifecycle"].Should().BeNull();
        body["sources"]!["asset"]!.GetValue<string>().Should().Be("unavailable");
    }

    [Fact]
    public async Task Gis_404_Returns_404()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "missing", HttpStatusCode.NotFound);
        StubAsset(factory, "missing", HttpStatusCode.OK, "{\"id\":\"missing\",\"assetCode\":\"x\",\"status\":\"Active\"}");
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/missing/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Gis_Down_Returns_502()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.InternalServerError);
        StubAsset(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\",\"assetCode\":\"x\",\"status\":\"Active\"}");
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.BadGateway);
    }

    [Fact]
    public async Task Invalid_Type_Returns_400()
    {
        using var factory = new BffApiFactory();
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=zone");

        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Forwards_Auth_And_Tenant_To_Downstream()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\"}");
        StubAsset(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\",\"assetCode\":\"x\",\"status\":\"Active\"}");
        using var client = AuthedClient(factory);

        await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        // Exactly one GIS call expected (retries disabled); assert count first so a
        // stray call yields a clear diagnostic rather than a noisy InvalidOperationException.
        factory.Gis.LogEntries.Should().ContainSingle();
        var gisReq = factory.Gis.LogEntries.Single().RequestMessage!;
        gisReq.Headers!.Should().ContainKey("Authorization");
        gisReq.Headers!["X-Tenant-Id"].Should().Contain("tenant-1");
    }
}
