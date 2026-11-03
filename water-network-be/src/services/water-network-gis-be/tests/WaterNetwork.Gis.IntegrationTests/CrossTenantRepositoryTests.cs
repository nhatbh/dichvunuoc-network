using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class CrossTenantRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task NodeRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();

        // Unique asset code per run: the shared PostGIS container is not truncated between
        // runs, so a literal code would hit the unique constraint on repeated local execution.
        var node = NetworkNode.Register("tenant-A", new AssetCode($"ND-{Guid.NewGuid():N}"[..16]), NodeType.Junction, new GeoPoint(10.0, 106.0));
        await repo.SaveAsync(node);

        (await repo.GetByIdAsync("tenant-A", node.Id)).Should().NotBeNull("owning tenant can load");
        (await repo.GetByIdAsync("tenant-B", node.Id)).Should().BeNull("other tenant must not load");
    }

    [Fact]
    public async Task PipeRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        // GUID-sliced asset code per run (shared PostGIS container is not truncated between runs).
        // Stub node IDs are fine: there is no DB-level FK on from/to node, and saving directly via the
        // repo bypasses the handler's endpoint-existence check — this test only exercises tenant scoping.
        var pipe = NetworkPipe.Register("tenant-A", new AssetCode($"PP-{Guid.NewGuid():N}"[..16]), "node-a", "node-b",
            new PipeGeometry(new List<GeoPoint> { new GeoPoint(10.0, 106.0), new GeoPoint(10.1, 106.1) }),
            new Diameter(150), PipeMaterial.Parse("HDPE"), 100.0, null);
        await repo.SaveAsync(pipe);

        (await repo.GetByIdAsync("tenant-A", pipe.Id)).Should().NotBeNull("owning tenant can load");
        (await repo.GetByIdAsync("tenant-B", pipe.Id)).Should().BeNull("other tenant must not load");
    }

    [Fact]
    public async Task DeviceRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        // GUID-sliced asset code per run (shared PostGIS container is not truncated between runs).
        var device = NetworkDevice.Install("tenant-A", new AssetCode($"DV-{Guid.NewGuid():N}"[..16]),
            DeviceType.Parse("Valve"), DeviceHost.For(DeviceType.Parse("Valve"), "pipe-x", null),
            new GeoPoint(10.0, 106.0));
        await repo.SaveAsync(device);

        (await repo.GetByIdAsync("tenant-A", device.Id)).Should().NotBeNull("owning tenant can load");
        (await repo.GetByIdAsync("tenant-B", device.Id)).Should().BeNull("other tenant must not load");
    }
}
