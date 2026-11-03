using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RemoveDeviceCommandHandlerTests
{
    private readonly INetworkDeviceRepository _deviceRepo = Substitute.For<INetworkDeviceRepository>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    private static NetworkDevice MakeDevice() =>
        NetworkDevice.Install("tenant-001", new AssetCode("DV-001"),
            DeviceType.Parse("Valve"),
            DeviceHost.For(DeviceType.Parse("Valve"), "pipe-x", null),
            new GeoPoint(10.0, 106.0));

    private RemoveDeviceCommandHandler CreateHandler()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        return new(_deviceRepo, _tenant);
    }

    // 1. Happy path: device exists → DeleteAsync called.
    [Fact]
    public async Task Handle_DeviceExists_Calls_DeleteAsync()
    {
        var device = MakeDevice();
        _deviceRepo.GetByIdAsync("tenant-001", device.Id, Arg.Any<CancellationToken>()).Returns(device);

        var handler = CreateHandler();
        await handler.HandleAsync(new RemoveDeviceCommand(device.Id), CancellationToken.None);

        await _deviceRepo.Received(1).DeleteAsync(device.Id, Arg.Any<CancellationToken>());
    }

    // 2. Device missing → NotFoundException; DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_DeviceMissing_Throws_NotFoundException_And_Does_Not_Delete()
    {
        _deviceRepo.GetByIdAsync("tenant-001", "device-missing", Arg.Any<CancellationToken>()).Returns((NetworkDevice?)null);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(new RemoveDeviceCommand("device-missing"), CancellationToken.None);

        await act.Should().ThrowAsync<NotFoundException>();
        await _deviceRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // 3. Cross-tenant: device owned by another tenant → NotFound, DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_Device_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Delete()
    {
        var device = MakeDevice();
        _deviceRepo.GetByIdAsync("tenant-999", device.Id, Arg.Any<CancellationToken>()).Returns(device);

        var handler = CreateHandler();
        await handler.Invoking(h => h.HandleAsync(new RemoveDeviceCommand(device.Id), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
        await _deviceRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }
}
