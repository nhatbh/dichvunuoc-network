using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class TenantAppEntitlementTests
{
    private const string AccessPath = "/api/platform/app-catalog/me/apps/ml-0/access";

    [Theory]
    [InlineData("/api/gis/bootstrap")]
    [InlineData("/bff/water-network/map/bootstrap")]
    public async Task Direct_public_aliases_cannot_bypass_disabled_tenant_app(string path)
    {
        using var factory = new BffApiFactory();
        StubEntitlement(factory, HttpStatusCode.Forbidden);
        using var client = AuthedClient(factory);

        var response = await client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        factory.AppCatalog.LogEntries.Should().ContainSingle();
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Catalog_outage_fails_closed_as_503_without_calling_gis()
    {
        using var factory = new BffApiFactory();
        StubEntitlement(factory, HttpStatusCode.InternalServerError);
        using var client = AuthedClient(factory);

        var response = await client.GetAsync("/api/gis/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Allowed_decision_forwards_current_bearer_and_is_cached_for_same_key()
    {
        using var factory = new BffApiFactory();
        StubBootstrap(factory);
        using var client = AuthedClient(factory);

        var first = await client.GetAsync("/api/gis/bootstrap");
        var second = await client.GetAsync("/bff/water-network/map/bootstrap");

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        factory.AppCatalog.LogEntries.Should().ContainSingle();
        var request = factory.AppCatalog.LogEntries.Single().RequestMessage!;
        request.Headers.Should().ContainKey("Authorization");
        request.Headers!["Authorization"].Single().Should().StartWith("Bearer ");
        request.Headers!["Authorization"].Single().Should().Be(client.DefaultRequestHeaders.Authorization!.ToString());
        factory.Gis.LogEntries.Should().HaveCount(2);
    }

    [Fact]
    public async Task Denied_decision_is_cached_but_outage_is_not_cached()
    {
        using (var deniedFactory = new BffApiFactory())
        {
            StubEntitlement(deniedFactory, HttpStatusCode.Forbidden);
            using var client = AuthedClient(deniedFactory);

            (await client.GetAsync("/api/gis/bootstrap")).StatusCode
                .Should().Be(HttpStatusCode.Forbidden);
            (await client.GetAsync("/bff/water-network/map/bootstrap")).StatusCode
                .Should().Be(HttpStatusCode.Forbidden);
            deniedFactory.AppCatalog.LogEntries.Should().ContainSingle();
        }

        using (var outageFactory = new BffApiFactory())
        {
            StubEntitlement(outageFactory, HttpStatusCode.InternalServerError);
            using var client = AuthedClient(outageFactory);

            (await client.GetAsync("/api/gis/bootstrap")).StatusCode
                .Should().Be(HttpStatusCode.ServiceUnavailable);
            (await client.GetAsync("/api/gis/bootstrap")).StatusCode
                .Should().Be(HttpStatusCode.ServiceUnavailable);
            outageFactory.AppCatalog.LogEntries.Should().HaveCount(2);
        }
    }

    [Fact]
    public async Task Cache_is_partitioned_by_tenant()
    {
        using var factory = new BffApiFactory();
        StubBootstrap(factory);
        using var tenantOne = AuthedClient(factory, organizationAlias: "tenant1");
        using var tenantTwo = AuthedClient(factory, organizationAlias: "tenant2");

        (await tenantOne.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await tenantTwo.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.OK);

        factory.AppCatalog.LogEntries.Should().HaveCount(2);
    }

    [Theory]
    [InlineData("second-user", false)]
    [InlineData("entitlement-user", true)]
    public async Task Allow_cache_cannot_cross_actor_or_changed_token_claims(string secondSubject, bool changedClaims)
    {
        using var factory = new BffApiFactory();
        StubBootstrap(factory);
        using var first = AuthedClient(factory);
        (await first.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.OK);
        StubEntitlement(factory, HttpStatusCode.Forbidden);
        using var second = AuthedClient(factory, subject: secondSubject,
            permissions: changedClaims ? ["network-gis:read", "network-design:read"] : ["network-gis:read"]);
        (await second.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await first.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.OK);
        factory.AppCatalog.LogEntries.Should().HaveCount(2);
        factory.Gis.LogEntries.Should().HaveCount(2);
    }

    [Theory]
    [InlineData("{\"apps\":[{\"code\":\"ml-0\",\"enabled\":\"true\"}]}")]
    [InlineData("{\"apps\":[{\"code\":\"ml-0\",\"enabled\":true},{\"code\":\"ml-0\",\"enabled\":true}]}")]
    [InlineData("not JSON")]
    public async Task Unexpected_success_body_cannot_authorize_or_fall_back_to_menu(string body)
    {
        using var factory = new BffApiFactory();
        StubEntitlement(factory, HttpStatusCode.OK, body);
        using var client = AuthedClient(factory);
        (await client.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await client.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        factory.AppCatalog.LogEntries.Should().HaveCount(2);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Oversized_unexpected_response_is_unavailable_before_buffering_entire_body()
    {
        using var factory = new BffApiFactory();
        StubEntitlement(factory, HttpStatusCode.OK, "{\"padding\":\"" + new string('a', 1024 * 1024) + "\",\"apps\":[]}");
        using var client = AuthedClient(factory);
        (await client.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Missing_subject_is_denied_before_catalog_lookup()
    {
        using var factory = new BffApiFactory();
        using var client = AuthedClient(factory, subject: "");
        (await client.GetAsync("/api/gis/bootstrap")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        factory.AppCatalog.LogEntries.Should().BeEmpty();
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/openapi/v1.json")]
    public async Task Operational_endpoints_are_not_tenant_app_gated(string path)
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        factory.AppCatalog.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Endpoint_permission_is_still_required_before_entitlement_check()
    {
        using var factory = new BffApiFactory();
        using var client = AuthedClient(factory, permissions: []);

        var response = await client.GetAsync("/api/gis/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        factory.AppCatalog.LogEntries.Should().BeEmpty();
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    private static HttpClient AuthedClient(
        BffApiFactory factory,
        string organizationAlias = "tenant1",
        string[]? permissions = null,
        string subject = "entitlement-user")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateOrganizationTokenForAuthorizedParty(
            new JwtOptions(),
            subject: subject,
            organizationAlias: organizationAlias,
            tenantId: $"tnt_{organizationAlias}",
            organizationId: $"org-{organizationAlias}",
            authorizedParty: "water-network-gis-fe",
            permissions: permissions ?? ["network-gis:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static void StubEntitlement(BffApiFactory factory, HttpStatusCode status, string? body = null)
    {
        factory.AppCatalog.ResetMappings();
        factory.AppCatalog.Given(Request.Create().WithPath(AccessPath).UsingGet())
            .RespondWith(Response.Create().WithStatusCode((int)status)
                .WithHeader("Content-Type", "application/json").WithBody(body ?? ""));
    }

    private static void StubBootstrap(BffApiFactory factory) =>
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets/bootstrap").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200)
                .WithHeader("Content-Type", "application/json")
                .WithBody("{\"schemaVersion\":1,\"hasData\":false}"));
}
