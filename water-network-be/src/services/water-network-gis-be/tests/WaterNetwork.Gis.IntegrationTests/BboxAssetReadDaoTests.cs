using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class BboxAssetReadDaoTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    // Small bbox around the seed location (HCMC). All "inside" assets sit here.
    private const string InsideBbox = "106.65,10.76,106.67,10.77";

    private static HttpClient WriteClient(GisApiFactory factory)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "u", tenantId: "tenant-bbox",
            authorizedParty: "water-network-gis-fe", permissions: ["network-gis:write"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> SeedNode(HttpClient c, double lat, double lng)
    {
        var resp = await c.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = lat, longitude = lng
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    private static async Task<string> SeedPipe(HttpClient c, string fromNodeId, string toNodeId)
    {
        var resp = await c.PostAsJsonAsync("/api/network/pipes", new
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

    private static async Task<string> SeedDevice(HttpClient c, string hostNodeId)
    {
        var resp = await c.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Pump",
            hostNodeId,
            latitude = 10.762700,
            longitude = 106.660500
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];
    }

    private static async Task<IReadOnlyList<BboxAssetRow>> RunQuery(
        GisApiFactory factory, string bboxRaw, string[] types, int fetchLimit)
    {
        var parsed = Bbox.TryParse(bboxRaw, out var bbox);
        parsed.Should().BeTrue("test bbox string must be valid");
        using var scope = factory.Services.CreateScope();
        var dao = scope.ServiceProvider.GetRequiredService<IBboxAssetReadDao>();
        var query = new GetAssetsInBboxQuery(bbox!.MinLng, bbox.MinLat, bbox.MaxLng, bbox.MaxLat, types, fetchLimit);
        return await dao.QueryAsync("tenant-bbox", query, fetchLimit, default);
    }

    [Fact]
    public async Task Returns_Only_Assets_Inside_Bbox()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);

        var inside = await SeedNode(client, 10.765, 106.66);
        var outside = await SeedNode(client, 20.0, 120.0); // far away

        var rows = await RunQuery(factory, InsideBbox, ["node"], 100);

        rows.Select(r => r.Id).Should().Contain(inside);
        rows.Select(r => r.Id).Should().NotContain(outside);
    }

    [Fact]
    public async Task Filters_By_Type()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);
        var nodeId = await SeedNode(client, 10.765, 106.66);

        // Querying pipes returns no node rows...
        var pipeRows = await RunQuery(factory, InsideBbox, ["pipe"], 100);
        pipeRows.Should().NotContain(r => r.Id == nodeId);

        // ...while querying nodes does surface the seeded node (proves cross-type filtering).
        var nodeRows = await RunQuery(factory, InsideBbox, ["node"], 100);
        nodeRows.Should().Contain(r => r.Id == nodeId && r.Kind == "Node");
    }

    [Fact]
    public async Task Honors_Fetch_Limit()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);
        await SeedNode(client, 10.7651, 106.661);
        await SeedNode(client, 10.7652, 106.662);
        await SeedNode(client, 10.7653, 106.663);

        var rows = await RunQuery(factory, InsideBbox, ["node"], 3);

        rows.Count.Should().Be(3);
    }

    [Fact]
    public async Task Node_Row_Has_GeoJson_And_Active_Status()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);
        var id = await SeedNode(client, 10.765, 106.66);

        var rows = await RunQuery(factory, InsideBbox, ["node"], 100);
        var row = rows.Single(r => r.Id == id);

        row.Kind.Should().Be("Node");
        row.Status.Should().Be("Active");
        row.GeoJson.Should().Contain("\"type\":\"Point\"");
        row.NodeType.Should().Be("Junction");
    }

    [Fact]
    public async Task Results_Are_Ordered_By_Id_For_Stable_Truncation()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);

        // Seed several nodes inside the bbox.
        for (var i = 0; i < 5; i++)
            await SeedNode(client, 10.765 + i * 0.0001, 106.66 + i * 0.0001);

        var rows = await RunQuery(factory, InsideBbox, ["node"], 100);

        // The DAO orders by id, so the returned ids must be in ascending order —
        // this is what makes a truncated page (limit < total) return a stable subset.
        var ids = rows.Select(r => r.Id).ToList();
        ids.Should().BeInAscendingOrder();
    }

    [Fact]
    public async Task Pipe_And_Device_Rows_Materialize_With_Type_Specific_Columns()
    {
        await using var factory = new GisApiFactory(postgis);
        var client = WriteClient(factory);

        var nodeA = await SeedNode(client, 10.762622, 106.660172);
        var nodeB = await SeedNode(client, 10.763000, 106.661000);
        var pipeId = await SeedPipe(client, nodeA, nodeB);
        var deviceId = await SeedDevice(client, nodeA);

        var rows = await RunQuery(factory, InsideBbox, ["pipe", "device"], 100);

        var pipe = rows.Single(r => r.Id == pipeId);
        pipe.Kind.Should().Be("Pipe");
        pipe.Status.Should().Be("Active");
        pipe.GeoJson.Should().Contain("LineString");
        pipe.DiameterMm.Should().Be(100);
        pipe.Material.Should().Be("HDPE");
        pipe.FromNodeId.Should().Be(nodeA);
        pipe.ToNodeId.Should().Be(nodeB);

        var device = rows.Single(r => r.Id == deviceId);
        device.Kind.Should().Be("Device");
        device.Status.Should().Be("Active");
        device.GeoJson.Should().Contain("Point");
        device.DeviceType.Should().Be("Pump");
        device.HostNodeId.Should().Be(nodeA);
    }
}
