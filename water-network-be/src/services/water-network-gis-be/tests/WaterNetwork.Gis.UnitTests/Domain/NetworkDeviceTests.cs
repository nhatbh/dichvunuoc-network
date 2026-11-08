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
        component: ComponentCode.Parse("GateValve"),
        host: DeviceHost.For(ComponentCode.Parse("GateValve"), "pipe-1", null),
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
        evt.Data.ComponentCode.Should().Be("GateValve");
        evt.Data.Functions.Should().Equal("isolates");
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
            component: ComponentCode.Parse("Hydrant"),
            host: DeviceHost.For(ComponentCode.Parse("Hydrant"), null, "node-1"),
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
        device.Component.Value.Should().Be("Hydrant");
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
        evt.Data.ComponentCode.Should().Be("GateValve");
    }

    [Fact]
    public void Install_Keeps_Validated_Properties_On_The_Event()
    {
        var component = ComponentCode.Parse("PRV");
        var device = NetworkDevice.Install("tenant-001", new AssetCode("DV-PRV"), component,
            DeviceHost.For(component, "pipe-1", null), new GeoPoint(10.0, 106.0),
            AssetProperties.For(component, new Dictionary<string, string> { ["setpoint"] = "35", ["state"] = "open" }));

        device.Properties.Values.Should().Contain("setpoint", "35");
        var evt = device.GetDomainEvents().Single().Should().BeOfType<DeviceInstalled>().Subject;
        evt.Data.Properties.Should().Contain("state", "open");
        evt.Data.Functions.Should().Equal("controls");
    }

    [Fact]
    public void Install_Rejects_A_Host_The_Catalog_Does_Not_Allow()
    {
        var hydrant = ComponentCode.Parse("Hydrant");
        var act = () => DeviceHost.For(hydrant, "pipe-1", null);
        act.Should().Throw<WaterPlatform.BuildingBlocks.Domain.Exceptions.DomainException>();
    }
}
