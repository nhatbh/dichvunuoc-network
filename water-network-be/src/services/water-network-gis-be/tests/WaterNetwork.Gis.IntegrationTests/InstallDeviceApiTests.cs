using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class InstallDeviceApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
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

    private static async Task<string> SeedNodeAsync(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16],
            nodeType = "Junction",
            latitude = 10.762622,
            longitude = 106.660172
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    private static async Task<string> SeedPipeAsync(HttpClient client)
    {
        var fromId = await SeedNodeAsync(client);
        var toId = await SeedNodeAsync(client);
        var resp = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = fromId,
            toNodeId = toId,
            points = new[]
            {
                new { lat = 10.762622, lng = 106.660172 },
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 100.0,
            material = "HDPE"
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    private static object DeviceBody(string assetCode, string deviceType,
        string? hostPipeId = null, string? hostNodeId = null) => new
    {
        assetCode,
        deviceType,
        hostPipeId,
        hostNodeId,
        latitude = 10.762700,
        longitude = 106.660500
    };

    [Fact]
    public async Task Install_Valve_On_Pipe_Returns_201_And_Get_Returns_All_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var code = $"DV-{Guid.NewGuid():N}"[..16];

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody(code, "Valve", hostPipeId: pipeId));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await response.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
        id.Should().StartWith("device-");
        response.Headers.Location!.ToString().Should().Contain(id);

        var detail = await client.GetAsync($"/api/network/devices/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await detail.Content.ReadFromJsonAsync<Dictionary<string, object>>();
        body!["id"].ToString().Should().Be(id);
        body["assetCode"].ToString().Should().Be(code);
        body["deviceType"].ToString().Should().Be("Valve");
        body["hostPipeId"].ToString().Should().Be(pipeId);
        var lat = double.Parse(body["latitude"].ToString()!, CultureInfo.InvariantCulture);
        lat.Should().BeApproximately(10.762700, 1e-5, "latitude must round-trip through PostGIS");
        var lng = double.Parse(body["longitude"].ToString()!, CultureInfo.InvariantCulture);
        lng.Should().BeApproximately(106.660500, 1e-5, "longitude must round-trip through PostGIS");
    }

    [Fact]
    public async Task Install_Pump_On_Node_Returns_201()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var nodeId = await SeedNodeAsync(client);
        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Pump", hostNodeId: nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await response.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];

        var detail = await client.GetAsync($"/api/network/devices/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await detail.Content.ReadFromJsonAsync<Dictionary<string, object?>>();
        body!["hostNodeId"]!.ToString().Should().Be(nodeId, "hostNodeId must round-trip through PostGIS");
        // hostPipeId should be absent or null when device is hosted on a node
        if (body.TryGetValue("hostPipeId", out var hostPipeVal))
            hostPipeVal.Should().BeNull("hostPipeId must be null when device is hosted on a node");
    }

    [Theory]
    [InlineData(true)]   // PressureSensor trên pipe
    [InlineData(false)]  // PressureSensor trên node
    public async Task Install_PressureSensor_On_Either_Host_Returns_201(bool onPipe)
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        string? pipeId = onPipe ? await SeedPipeAsync(client) : null;
        string? nodeId = onPipe ? null : await SeedNodeAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "PressureSensor", pipeId, nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Valve_Missing_HostPipe_Returns_400_DomainRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Valve"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("DOMAIN_RULE");
    }

    [Fact]
    public async Task Valve_With_HostNode_Returns_400_DomainRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var nodeId = await SeedNodeAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Valve", pipeId, nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("DOMAIN_RULE");
    }

    [Fact]
    public async Task PressureSensor_With_Both_Hosts_Returns_400_DomainRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var nodeId = await SeedNodeAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "PressureSensor", pipeId, nodeId));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("DOMAIN_RULE");
    }

    [Fact]
    public async Task Host_Pipe_Not_Found_Returns_422_BusinessRule()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Valve", hostPipeId: "pipe-does-not-exist"));

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("BUSINESS_RULE");
        body.Should().Contain("pipe-does-not-exist");
    }

    [Fact]
    public async Task Unknown_DeviceType_Returns_400_ValidationFailed()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Sprinkler", hostPipeId: "pipe-x"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Invalid_Latitude_Returns_400_ValidationFailed()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var response = await client.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Valve",
            hostPipeId = pipeId,
            hostNodeId = (string?)null,
            latitude = 99.0,
            longitude = 106.660500
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Duplicate_AssetCode_Returns_409()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var code = $"DV-{Guid.NewGuid():N}"[..16];

        (await client.PostAsJsonAsync("/api/network/devices", DeviceBody(code, "Valve", pipeId)))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        var conflict = await client.PostAsJsonAsync("/api/network/devices", DeviceBody(code, "Valve", pipeId));
        conflict.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await conflict.Content.ReadAsStringAsync()).Should().Contain("CONFLICT");
    }

    [Fact]
    public async Task Get_Nonexistent_Device_Returns_404()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:read");

        var response = await client.GetAsync("/api/network/devices/device-does-not-exist");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Successful_Post_Creates_Outbox_Message_With_Type_DeviceInstalled()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var pipeId = await SeedPipeAsync(client);
        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "FlowMeter", hostPipeId: pipeId));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var deviceId = (await response.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];

        using var scope = factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var outboxEntry = dbContext.OutboxEntries
            .FirstOrDefault(e => e.AggregateId == deviceId && e.EventType == "DeviceInstalled");
        outboxEntry.Should().NotBeNull();
        Guid.Parse(outboxEntry!.Id).Version.Should().Be(7,
            "outbox entry ids must be time-ordered uuid v7");
    }

    [Fact]
    public async Task Missing_Permission_Returns_403()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:read"); // missing write

        var response = await client.PostAsJsonAsync("/api/network/devices",
            DeviceBody($"DV-{Guid.NewGuid():N}"[..16], "Valve", hostPipeId: "pipe-x"));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
