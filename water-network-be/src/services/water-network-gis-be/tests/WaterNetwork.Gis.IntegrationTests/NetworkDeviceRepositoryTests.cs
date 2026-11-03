using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class NetworkDeviceRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    // ─── helpers ─────────────────────────────────────────────────────────────

    private static NetworkDevice MakeValve(
        string tenantId = "tenant-001",
        string? assetCode = null,
        string hostPipeId = "pipe-x",
        double lat = 10.762622,
        double lng = 106.660172)
    {
        var code = assetCode ?? $"DV-{Guid.NewGuid():N}"[..16];
        var deviceType = DeviceType.Parse("Valve");
        return NetworkDevice.Install(
            tenantId,
            new AssetCode(code),
            deviceType,
            DeviceHost.For(deviceType, hostPipeId, null),
            new GeoPoint(lat, lng));
    }

    private static NetworkDevice MakePump(
        string tenantId = "tenant-001",
        string? assetCode = null,
        string hostNodeId = "node-y",
        double lat = 10.762622,
        double lng = 106.660172)
    {
        var code = assetCode ?? $"DV-{Guid.NewGuid():N}"[..16];
        var deviceType = DeviceType.Parse("Pump");
        return NetworkDevice.Install(
            tenantId,
            new AssetCode(code),
            deviceType,
            DeviceHost.For(deviceType, null, hostNodeId),
            new GeoPoint(lat, lng));
    }

    private static async Task MigrateAsync(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await db.Database.MigrateAsync();
    }

    // ─── tests ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Save_Then_Get_Roundtrip_Valve_Preserves_All_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var device = MakeValve(
            tenantId: "tenant-rt-valve",
            hostPipeId: "pipe-x",
            lat: 10.762622,
            lng: 106.660172);

        await repository.SaveAsync(device);

        var loaded = await repository.GetByIdAsync(device.Id);
        loaded.Should().NotBeNull();
        loaded!.TenantId.Should().Be(device.TenantId);
        loaded.AssetCode.Value.Should().Be(device.AssetCode.Value);
        loaded.DeviceType.ToString().Should().Be("Valve");
        loaded.Host.HostPipeId.Should().Be("pipe-x");
        loaded.Host.HostNodeId.Should().BeNull();
        loaded.Location.Latitude.Should().BeApproximately(10.762622, 1e-9);
        loaded.Location.Longitude.Should().BeApproximately(106.660172, 1e-9);
        loaded.Version.Should().Be(device.Version);
    }

    [Fact]
    public async Task Save_Then_Get_Roundtrip_Pump_Preserves_All_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var device = MakePump(
            tenantId: "tenant-rt-pump",
            hostNodeId: "node-y",
            lat: 21.027764,
            lng: 105.834160);

        await repository.SaveAsync(device);

        var loaded = await repository.GetByIdAsync(device.Id);
        loaded.Should().NotBeNull();
        loaded!.TenantId.Should().Be(device.TenantId);
        loaded.AssetCode.Value.Should().Be(device.AssetCode.Value);
        loaded.DeviceType.ToString().Should().Be("Pump");
        loaded.Host.HostPipeId.Should().BeNull();
        loaded.Host.HostNodeId.Should().Be("node-y");
        loaded.Location.Latitude.Should().BeApproximately(21.027764, 1e-9);
        loaded.Location.Longitude.Should().BeApproximately(105.834160, 1e-9);
        loaded.Version.Should().Be(device.Version);
    }

    [Fact]
    public async Task Duplicate_AssetCode_Same_Tenant_Throws_DbUpdateException()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var assetCode = $"DV-{Guid.NewGuid():N}"[..16];

        var device1 = MakeValve(tenantId: "tenant-dup-dv", assetCode: assetCode);
        await repository.SaveAsync(device1);

        var device2 = MakeValve(tenantId: "tenant-dup-dv", assetCode: assetCode);

        // The unique constraint on (tenant_id, asset_code) fires at DB write time.
        var act = async () => await repository.SaveAsync(device2);
        await act.Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task SoftDelete_Update_Path_Increments_Version_And_Sets_DeletedAt()
    {
        // Proves the else-branch of PersistAsync (the update path): save (v0) → reload → SoftDelete
        // → save again → assert Version incremented and DeletedAt persisted.
        // Uses IgnoreQueryFilters() to read the soft-deleted row directly.
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var device = MakeValve(tenantId: "tenant-upd-dv");
        await repository.SaveAsync(device);
        var versionAfterInsert = device.Version;   // 0 after Install (no MarkAsModified yet)

        // Execute the update path: DeleteAsync calls GetByIdAsync → SoftDelete → SaveAsync.
        await repository.DeleteAsync(device.Id);

        // Assert via IgnoreQueryFilters so we can see the soft-deleted row.
        var persisted = await dbContext.NetworkDevices
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.Id == device.Id);
        persisted.Should().NotBeNull();
        persisted!.DeletedAt.Should().NotBeNull("SoftDelete must stamp DeletedAt");
        persisted.Version.Should().Be(versionAfterInsert + 1,
            "SoftDelete calls MarkAsModified which increments Version; the update path must persist that bump");
    }

    [Fact]
    public async Task Optimistic_Concurrency_Stale_Version_Throws_ConcurrencyException()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        // Save initial version (stored version = 0).
        var device = MakeValve(tenantId: "tenant-cc-dv");
        await repository.SaveAsync(device);

        // Reconstitute with a HIGHER version (simulates a stale snapshot).
        // The stored row is at version 0. Reconstitute with version=1 and no pending
        // events → expectedVersion = aggregate.Version - events.Count = 1 - 0 = 1.
        // PersistAsync: existing.Version (0) != expectedVersion (1) → ConcurrencyException.
        var staleDevice = NetworkDevice.Reconstitute(
            device.Id, device.TenantId, device.AssetCode,
            device.DeviceType, device.Host, device.Location,
            version: 1,            // higher than stored (0) → mismatch → ConcurrencyException
            createdAt: device.CreatedAt,
            updatedAt: device.UpdatedAt,
            deletedAt: null);

        var act = async () => await repository.SaveAsync(staleDevice);
        await act.Should().ThrowAsync<ConcurrencyException>();
    }

    [Fact]
    public async Task ExistsByAssetCode_Is_Scoped_Per_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var deviceA = MakeValve(tenantId: "tenant-A-dv-iso");
        await repository.SaveAsync(deviceA);

        // tenant-B must not see tenant-A's device.
        var existsForB = await repository.ExistsByAssetCodeAsync("tenant-B-dv-iso", deviceA.AssetCode.Value);
        existsForB.Should().BeFalse("a device belonging to tenant-A should not appear under tenant-B");

        var existsForA = await repository.ExistsByAssetCodeAsync("tenant-A-dv-iso", deviceA.AssetCode.Value);
        existsForA.Should().BeTrue();
    }

    // ─── GIS-3 soft-delete / exists tests ─────────────────────────────────────

    [Fact]
    public async Task DeleteAsync_SoftDeletes_Device_And_GetByIdAsync_Returns_Null()
    {
        // Proves the soft-delete round-trip: DeleteAsync stamps DeletedAt,
        // and the HasQueryFilter(DeletedAt==null) hides the row from GetByIdAsync.
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var device = MakeValve(tenantId: "tenant-del-dv2");
        await repository.SaveAsync(device);

        // Sanity: device is findable before deletion.
        var before = await repository.GetByIdAsync(device.Id);
        before.Should().NotBeNull();

        await repository.DeleteAsync(device.Id);

        // Soft-deleted rows are hidden by the global query filter on DeletedAt.
        var after = await repository.GetByIdAsync(device.Id);
        after.Should().BeNull("soft-deleted device must not be returned by GetByIdAsync");
    }

    [Fact]
    public async Task ExistsByHostPipeAsync_True_For_Live_Device_False_After_Deletion()
    {
        // Proves that soft-deleted devices do NOT count as live host references.
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var pipeId = $"pipe-{Guid.NewGuid():N}"[..20];
        var device = MakeValve(tenantId: "tenant-exists-hpipe2", hostPipeId: pipeId);
        await repository.SaveAsync(device);

        // While the device is live, the pipe has an attached device.
        var existsLive = await repository.ExistsByHostPipeAsync(pipeId);
        existsLive.Should().BeTrue("live device is hosted on the pipe");

        // After soft-deleting the device, the pipe no longer has live attached devices.
        await repository.DeleteAsync(device.Id);
        var existsDeleted = await repository.ExistsByHostPipeAsync(pipeId);
        existsDeleted.Should().BeFalse("soft-deleted device must not count as a live host reference");
    }

    [Fact]
    public async Task ExistsByHostNodeAsync_True_For_Live_Device_False_After_Deletion()
    {
        // Proves that soft-deleted devices do NOT count as live host references for nodes.
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        var repository = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var nodeId = $"node-{Guid.NewGuid():N}"[..20];
        var device = MakePump(tenantId: "tenant-exists-hnode2", hostNodeId: nodeId);
        await repository.SaveAsync(device);

        // While the device is live, the node has an attached device.
        var existsLive = await repository.ExistsByHostNodeAsync(nodeId);
        existsLive.Should().BeTrue("live device is hosted on the node");

        // After soft-deleting the device, the node no longer has live attached devices.
        await repository.DeleteAsync(device.Id);
        var existsDeleted = await repository.ExistsByHostNodeAsync(nodeId);
        existsDeleted.Should().BeFalse("soft-deleted device must not count as a live host reference");
    }
}
