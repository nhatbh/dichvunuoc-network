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

public class CrossTenantMutationGuardApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static readonly string[] WriteReadPermissions = ["network-gis:write", "network-gis:read"];

    private static HttpClient ClientFor(GisApiFactory factory, string tenantId)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "test-user", tenantId: tenantId,
            authorizedParty: "water-network-gis-fe",
            permissions: WriteReadPermissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Tenant_B_Cannot_Relocate_Or_Remove_Tenant_A_Assets()
    {
        await using var factory = new GisApiFactory(postgis);
        using var tenantA = ClientFor(factory, "tenant-A");
        using var tenantB = ClientFor(factory, "tenant-B");

        // Seed node + hosted device under tenant A.
        var nodeResp = await tenantA.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16],
            nodeType = "Junction", latitude = 10.0, longitude = 106.0
        });
        nodeResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var nodeId = (await nodeResp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];

        var deviceResp = await tenantA.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Pump",
            hostNodeId = nodeId,
            hostPipeId = (string?)null,
            latitude = 10.0,
            longitude = 106.0
        });
        deviceResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var deviceId = (await deviceResp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];

        // Tenant B mutations all 404.
        (await tenantB.PatchAsJsonAsync($"/api/network/nodes/{nodeId}/location",
            new { latitude = 11.0, longitude = 107.0 })).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.DeleteAsync($"/api/network/devices/{deviceId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.DeleteAsync($"/api/network/nodes/{nodeId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // DB unchanged: no relocate/delete outbox rows produced by tenant B's attempts.
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            db.OutboxEntries.Any(e => e.AggregateId == nodeId && e.EventType == "NodeRelocated").Should().BeFalse();
            db.OutboxEntries.Any(e => e.AggregateId == nodeId && e.EventType == "NodeDeleted").Should().BeFalse();
            db.OutboxEntries.Any(e => e.AggregateId == deviceId && e.EventType == "DeviceDeleted").Should().BeFalse();
        }

        // Control: tenant A (the owner) can still relocate its own node.
        (await tenantA.PatchAsJsonAsync($"/api/network/nodes/{nodeId}/location",
            new { latitude = 10.5, longitude = 106.5 })).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task Tenant_B_Cannot_Use_Tenant_A_Assets_As_Pipe_Endpoints_Or_Device_Hosts()
    {
        await using var factory = new GisApiFactory(postgis);
        using var tenantA = ClientFor(factory, "tenant-host-A");
        using var tenantB = ClientFor(factory, "tenant-host-B");

        async Task<string> SeedNode(string suffix, double latitude, double longitude)
        {
            var response = await tenantA.PostAsJsonAsync("/api/network/nodes", new
            {
                assetCode = $"ND-{suffix}-{Guid.NewGuid():N}"[..16],
                nodeType = "Junction",
                latitude,
                longitude
            });
            response.StatusCode.Should().Be(HttpStatusCode.Created);
            return (await response.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
        }

        var nodeA1 = await SeedNode("A1", 10.0, 106.0);
        var nodeA2 = await SeedNode("A2", 10.1, 106.1);

        var pipeResponse = await tenantB.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = nodeA1,
            toNodeId = nodeA2,
            points = new[]
            {
                new { lat = 10.0, lng = 106.0 },
                new { lat = 10.1, lng = 106.1 }
            },
            diameterMm = 100.0,
            material = "HDPE"
        });

        var deviceResponse = await tenantB.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Pump",
            hostNodeId = nodeA1,
            hostPipeId = (string?)null,
            latitude = 10.0,
            longitude = 106.0
        });

        pipeResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        deviceResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await pipeResponse.Content.ReadAsStringAsync()).Should().Contain("BUSINESS_RULE");
        (await deviceResponse.Content.ReadAsStringAsync()).Should().Contain("BUSINESS_RULE");
    }
}
