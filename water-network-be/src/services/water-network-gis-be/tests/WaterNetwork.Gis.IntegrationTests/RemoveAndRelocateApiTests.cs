using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class RemoveAndRelocateApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
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

    private static async Task<string> SeedPipeAsync(HttpClient client, string fromNodeId, string toNodeId)
    {
        var resp = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId,
            toNodeId,
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

    private static async Task<string> SeedDeviceAsync(HttpClient client, string? hostNodeId = null, string? hostPipeId = null)
    {
        var resp = await client.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Pump",
            hostPipeId,
            hostNodeId,
            latitude = 10.762700,
            longitude = 106.660500
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    [Fact]
    public async Task Remove_And_Relocate_Full_Scenario()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        // ── Seed: node A, node B, pipe P(A,B), device D hosted on node A ────────
        var nodeAId = await SeedNodeAsync(client);
        var nodeBId = await SeedNodeAsync(client);
        var pipeId = await SeedPipeAsync(client, nodeAId, nodeBId);
        var deviceId = await SeedDeviceAsync(client, hostNodeId: nodeAId);

        // ── 1. DELETE /api/network/nodes/{A} → 422 (pipe P alive) ───────────────
        var deleteNodeA1 = await client.DeleteAsync($"/api/network/nodes/{nodeAId}");
        deleteNodeA1.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "node A is an endpoint of pipe P → NetworkNode.HasConnectedPipes");
        (await deleteNodeA1.Content.ReadAsStringAsync()).Should().Contain("BUSINESS_RULE");

        // ── 2. DELETE /api/network/devices/{D} → 204; outbox has DeviceDeleted ──
        var deleteDevice = await client.DeleteAsync($"/api/network/devices/{deviceId}");
        deleteDevice.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            var deviceDeletedEntry = db.OutboxEntries
                .FirstOrDefault(e => e.AggregateId == deviceId && e.EventType == "DeviceDeleted");
            deviceDeletedEntry.Should().NotBeNull("DELETE device must produce a DeviceDeleted outbox entry");
        }

        // ── 3. DELETE node A → still 422 (pipe P alive). DELETE pipe P → 204 ───
        var deleteNodeA2 = await client.DeleteAsync($"/api/network/nodes/{nodeAId}");
        deleteNodeA2.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "pipe P still alive → cannot remove node A");

        var deletePipe = await client.DeleteAsync($"/api/network/pipes/{pipeId}");
        deletePipe.StatusCode.Should().Be(HttpStatusCode.NoContent,
            "pipe hosts no device → can be removed");

        // ── 4. DELETE node A → 204 (no live pipe; device already deleted) ───────
        var deleteNodeA3 = await client.DeleteAsync($"/api/network/nodes/{nodeAId}");
        deleteNodeA3.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            var nodeDeletedEntry = db.OutboxEntries
                .FirstOrDefault(e => e.AggregateId == nodeAId && e.EventType == "NodeDeleted");
            nodeDeletedEntry.Should().NotBeNull("DELETE node must produce a NodeDeleted outbox entry");
        }

        // ── 5. PATCH node B location → 204; outbox NodeRelocated; geometry-history 2 rows ──
        var relocate = await client.PatchAsJsonAsync($"/api/network/nodes/{nodeBId}/location", new
        {
            latitude = 10.5,
            longitude = 106.5
        });
        relocate.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            var relocatedEntry = db.OutboxEntries
                .FirstOrDefault(e => e.AggregateId == nodeBId && e.EventType == "NodeRelocated");
            relocatedEntry.Should().NotBeNull("PATCH location must produce a NodeRelocated outbox entry");
        }

        var historyResp = await client.GetAsync($"/api/network/nodes/{nodeBId}/geometry-history");
        historyResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var history = await historyResp.Content.ReadFromJsonAsync<List<GeometryVersionDto>>();
        history.Should().NotBeNull();
        history!.Should().HaveCount(2, "v1 from register + v2 from relocate");
        history[0].Version.Should().Be(2, "ordered version desc → v2 first");
        history[0].GeoJson.Should().Contain("106.5").And.Contain("10.5");
        history[1].Version.Should().Be(1, "v1 second");

        // ── 6. PATCH relocate with invalid latitude → 400 (validation) ──────────
        var badRelocate = await client.PatchAsJsonAsync($"/api/network/nodes/{nodeBId}/location", new
        {
            latitude = 99.0,
            longitude = 106.5
        });
        badRelocate.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await badRelocate.Content.ReadAsStringAsync()).Should().Contain("VALIDATION_FAILED");

        // ── 7. DELETE nonexistent node → 404 ─────────────────────────────────────
        var deleteNonExistent = await client.DeleteAsync($"/api/network/nodes/node-does-not-exist-{Guid.NewGuid():N}");
        deleteNonExistent.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
