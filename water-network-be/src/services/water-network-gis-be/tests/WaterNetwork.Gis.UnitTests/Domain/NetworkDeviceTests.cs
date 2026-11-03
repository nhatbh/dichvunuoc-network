using FluentAssertions;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class NetworkDeviceTests
{
    private static NetworkDevice InstallValve() => NetworkDevice.Install(
        tenantId: "tenant-001",
        assetCode: new AssetCode("DV-001"),
        deviceType: DeviceType.Parse("Valve"),
        host: DeviceHost.For(DeviceType.Parse("Valve"), "pipe-1", null),
        location: new GeoPoint(10.762622, 106.660172));

    [Fact]
    public void Install_Assigns_DevicePrefixed_Id()
        => InstallValve().Id.Should().StartWith("device-");

    [Fact]
    public void Install_Raises_Exactly_One_DeviceInstalled_Event()
    {
        var device = InstallValve();

        var events = device.GetDomainEvents();
        events.Should().ContainSingle();
        var evt = events.Single().Should().BeOfType<DeviceInstalled>().Subject;
        evt.AggregateId.Should().Be(device.Id);
        evt.Data.TenantId.Should().Be("tenant-001");
        evt.Data.AssetCode.Should().Be("DV-001");
        evt.Data.DeviceType.Should().Be("Valve");
        evt.Data.HostPipeId.Should().Be("pipe-1");
        evt.Data.HostNodeId.Should().BeNull();
        evt.Data.Latitude.Should().Be(10.762622);
        evt.Data.Longitude.Should().Be(106.660172);
    }

    [Fact]
    public void Reconstitute_Does_Not_Raise_Events()
    {
        var device = NetworkDevice.Reconstitute(
            id: "device-abc",
            tenantId: "tenant-001",
            assetCode: new AssetCode("DV-001"),
            deviceType: DeviceType.Parse("Pump"),
            host: DeviceHost.For(DeviceType.Parse("Pump"), null, "node-1"),
            location: new GeoPoint(10.0, 106.0),
            version: 3,
            createdAt: DateTime.UtcNow.AddDays(-1),
            updatedAt: DateTime.UtcNow,
            deletedAt: null);

        device.GetDomainEvents().Should().BeEmpty();
        device.Id.Should().Be("device-abc");
        device.TenantId.Should().Be("tenant-001");
        device.AssetCode.Value.Should().Be("DV-001");
        device.Version.Should().Be(3);
        device.DeviceType.ToString().Should().Be("Pump");
        device.Host.HostNodeId.Should().Be("node-1");
    }

    [Fact]
    public void SoftDelete_Stamps_DeletedAt_And_Raises_DeviceDeleted()
    {
        var device = InstallValve();
        device.ClearDomainEvents();
        var before = device.Version;

        device.SoftDelete();

        device.DeletedAt.Should().NotBeNull();
        device.Version.Should().Be(before + 1);
        var evt = device.GetDomainEvents().Single().Should().BeOfType<DeviceDeleted>().Subject;
        evt.AggregateId.Should().Be(device.Id);
        evt.Data.TenantId.Should().Be("tenant-001");
        evt.Data.AssetCode.Should().Be("DV-001");
        evt.Data.DeviceType.Should().Be("Valve");
    }
}
