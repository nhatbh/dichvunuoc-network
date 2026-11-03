using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Gis.IntegrationTests;

public sealed class AssetBootstrapApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient Client(GisApiFactory factory, string tenantId, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "bootstrap-user", tenantId: tenantId,
            authorizedParty: "water-network-gis-fe", permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static HttpClient OrganizationClient(
        GisApiFactory factory,
        string tenantId,
        string organizationAlias = "cwa",
        string? flatTenantId = null,
        params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateOrganizationTokenForAuthorizedParty(
            new JwtOptions(),
            subject: "organization-bootstrap-user",
            organizationAlias: organizationAlias,
            tenantId: tenantId,
            organizationId: "org-cwa",
            flatTenantId: flatTenantId,
            authorizedParty: "water-network-gis-fe",
            permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> SeedNode(HttpClient client, double lat, double lon)
    {
        var response = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16],
            nodeType = "Junction",
            latitude = lat,
            longitude = lon
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task Returns_Counts_Extent_Length_Material_And_Status_For_Current_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenantId = $"bootstrap-{Guid.NewGuid():N}";
        using var client = Client(factory, tenantId, "network-gis:write", "network-gis:read");

        var fromNodeId = await SeedNode(client, 20.0, 105.0);
        var toNodeId = await SeedNode(client, 21.0, 106.0);

        var pipeResponse = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId,
            toNodeId,
            points = new[]
            {
                new { lat = 20.0, lng = 105.0 },
                new { lat = 21.0, lng = 106.0 }
            },
            diameterMm = 200,
            material = "HDPE",
            lengthM = 123.4
        });
        pipeResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        var deviceResponse = await client.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Pump",
            hostPipeId = (string?)null,
            hostNodeId = fromNodeId,
            latitude = 19.5,
            longitude = 104.5
        });
        deviceResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        var response = await client.GetAsync("/api/network/assets/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("schemaVersion").GetInt32().Should().Be(1);
        json.GetProperty("hasData").GetBoolean().Should().BeTrue();

        var counts = json.GetProperty("counts");
        counts.GetProperty("nodes").GetInt64().Should().Be(2);
        counts.GetProperty("pipes").GetInt64().Should().Be(1);
        counts.GetProperty("devices").GetInt64().Should().Be(1);
        counts.GetProperty("total").GetInt64().Should().Be(4);
        json.GetProperty("pipeLengthM").GetDouble().Should().BeApproximately(123.4, 0.0001);

        var homeView = json.GetProperty("homeView");
        homeView.GetProperty("source").GetString().Should().Be("data_extent");
        var bbox = homeView.GetProperty("bbox");
        bbox[0].GetDouble().Should().BeApproximately(104.5, 0.0000001);
        bbox[1].GetDouble().Should().BeApproximately(19.5, 0.0000001);
        bbox[2].GetDouble().Should().BeApproximately(106.0, 0.0000001);
        bbox[3].GetDouble().Should().BeApproximately(21.0, 0.0000001);
        homeView.GetProperty("center").GetProperty("lon").GetDouble().Should().BeApproximately(105.25, 0.0000001);
        homeView.GetProperty("center").GetProperty("lat").GetDouble().Should().BeApproximately(20.25, 0.0000001);

        var material = json.GetProperty("materialMix").EnumerateArray().Single();
        material.GetProperty("material").GetString().Should().Be("HDPE");
        material.GetProperty("count").GetInt64().Should().Be(1);
        material.GetProperty("lengthM").GetDouble().Should().BeApproximately(123.4, 0.0001);

        var active = json.GetProperty("statusMix").EnumerateArray()
            .Single(x => x.GetProperty("status").GetString() == "Active");
        active.GetProperty("count").GetInt64().Should().Be(1);
    }

    [Fact]
    public async Task Empty_Tenant_Returns_Null_Home_View_And_Zeroes()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = Client(factory, $"empty-{Guid.NewGuid():N}", "network-gis:read");

        var json = await (await client.GetAsync("/api/network/assets/bootstrap"))
            .Content.ReadFromJsonAsync<JsonElement>();

        json.GetProperty("hasData").GetBoolean().Should().BeFalse();
        json.GetProperty("homeView").ValueKind.Should().Be(JsonValueKind.Null);
        json.GetProperty("counts").GetProperty("total").GetInt64().Should().Be(0);
        json.GetProperty("pipeLengthM").GetDouble().Should().Be(0);
        json.GetProperty("materialMix").GetArrayLength().Should().Be(0);
        json.GetProperty("statusMix").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Selected_Organization_Claim_Resolves_Tenant_Without_Flat_Tenant_Claim()
    {
        await using var factory = new GisApiFactory(postgis);
        var organizationAlias = $"cwa{Guid.NewGuid():N}"[..20];
        var tenantId = $"tnt_{organizationAlias}";
        using var writer = Client(factory, tenantId, "network-gis:write", "network-gis:read");
        await SeedNode(writer, 21.40, 105.50);

        using var reader = OrganizationClient(
            factory,
            tenantId,
            organizationAlias,
            permissions: ["network-gis:read"]);
        var response = await reader.GetAsync("/api/network/assets/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("counts").GetProperty("nodes").GetInt64().Should().Be(1);
    }

    [Fact]
    public async Task Mismatched_Flat_And_Organization_Tenants_Are_Rejected_Before_Gis_Query()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = OrganizationClient(
            factory,
            tenantId: "tnt_cwa",
            flatTenantId: "tnt_other",
            permissions: ["network-gis:read"]);

        var response = await client.GetAsync("/api/network/assets/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Strict_Gis_Config_Rejects_Legacy_Flat_Only_Token()
    {
        await using var baseFactory = new GisApiFactory(postgis);
        await using var strictFactory = baseFactory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["MultiTenancy:AllowFlatTenantClaimCompatibility"] = "false"
                })));
        using var client = strictFactory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(),
            subject: "legacy-user",
            tenantId: "legacy-cwa",
            authorizedParty: "water-network-gis-fe",
            permissions: ["network-gis:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/network/assets/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Other_Tenant_Cannot_See_Seeded_Assets_Or_Extent()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenantA = $"tenant-a-{Guid.NewGuid():N}";
        var tenantB = $"tenant-b-{Guid.NewGuid():N}";
        using var writer = Client(factory, tenantA, "network-gis:write", "network-gis:read");
        await SeedNode(writer, 10.75, 106.65);

        using var other = Client(factory, tenantB, "network-gis:read");
        other.DefaultRequestHeaders.Add("X-Tenant-Id", tenantA);
        var json = await (await other.GetAsync("/api/network/assets/bootstrap"))
            .Content.ReadFromJsonAsync<JsonElement>();

        json.GetProperty("hasData").GetBoolean().Should().BeFalse();
        json.GetProperty("counts").GetProperty("total").GetInt64().Should().Be(0);
        json.GetProperty("homeView").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Requires_Network_Gis_Read_Permission()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = Client(factory, $"auth-{Guid.NewGuid():N}", "network-gis:write");

        var response = await client.GetAsync("/api/network/assets/bootstrap");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
