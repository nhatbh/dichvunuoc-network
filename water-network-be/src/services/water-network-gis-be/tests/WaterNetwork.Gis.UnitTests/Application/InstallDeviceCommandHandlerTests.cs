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

public class InstallDeviceCommandHandlerTests
{
    private readonly INetworkDeviceRepository _deviceRepo = Substitute.For<INetworkDeviceRepository>();
    private readonly INetworkPipeRepository _pipeRepo = Substitute.For<INetworkPipeRepository>();
    private readonly INetworkNodeRepository _nodeRepo = Substitute.For<INetworkNodeRepository>();
    private readonly ITenantContextAccessor _tenantAccessor = Substitute.For<ITenantContextAccessor>();

    private static NetworkNode MakeNode() =>
        NetworkNode.Register("tenant-001", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));

    private static NetworkPipe MakePipe() =>
        NetworkPipe.Register("tenant-001", new AssetCode("PP-1"), "node-a", "node-b",
            new PipeGeometry(new[] { new GeoPoint(10.0, 106.0), new GeoPoint(10.1, 106.1) }),
            new Diameter(100), PipeMaterial.Parse("HDPE"), 100.0, null);

    private InstallDeviceCommandHandler CreateHandler()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        _deviceRepo.SaveAsync(Arg.Any<NetworkDevice>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<NetworkDevice>());
        return new InstallDeviceCommandHandler(_deviceRepo, _pipeRepo, _nodeRepo, _tenantAccessor);
    }

    private static InstallDeviceCommand MakeCommand(
        string deviceType = "Valve", string? hostPipeId = "pipe-1", string? hostNodeId = null) =>
        new(AssetCode: "DV-001", DeviceType: deviceType,
            HostPipeId: hostPipeId, HostNodeId: hostNodeId,
            Latitude: 10.762622, Longitude: 106.660172);

    [Fact]
    public async Task Handle_ValveOnExistingPipe_SavesAndReturnsId()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        _pipeRepo.GetByIdAsync("tenant-001", "pipe-1", Arg.Any<CancellationToken>()).Returns(MakePipe());

        var handler = CreateHandler();
        var id = await handler.HandleAsync(MakeCommand(), CancellationToken.None);

        id.Should().StartWith("device-");
        await _deviceRepo.Received(1).SaveAsync(
            Arg.Is<NetworkDevice>(d =>
                d.TenantId == "tenant-001"
                && d.AssetCode.Value == "DV-001"
                && d.Host.HostPipeId == "pipe-1"
                && d.Host.HostNodeId == null),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_PumpOnExistingNode_SavesAndReturnsId()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("tenant-001", "node-1", Arg.Any<CancellationToken>()).Returns(MakeNode());

        var handler = CreateHandler();
        var id = await handler.HandleAsync(
            MakeCommand(deviceType: "Pump", hostPipeId: null, hostNodeId: "node-1"), CancellationToken.None);

        id.Should().StartWith("device-");
        await _pipeRepo.DidNotReceive().GetByIdAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await _nodeRepo.Received(1).GetByIdAsync(
            "tenant-001", "node-1", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_HostPipe_NotFound_Throws_BusinessRuleException()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        _pipeRepo.GetByIdAsync("tenant-001", "pipe-1", Arg.Any<CancellationToken>()).Returns((NetworkPipe?)null);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkDevice.HostNotFound");
    }

    [Fact]
    public async Task Handle_HostNode_Deleted_Throws_BusinessRuleException()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);
        var deletedNode = NetworkNode.Reconstitute(
            id: "node-1", tenantId: "tenant-001", assetCode: new AssetCode("ND-DEL"),
            nodeType: NodeType.Junction, location: new GeoPoint(10.0, 106.0),
            version: 1, createdAt: DateTime.UtcNow.AddDays(-1), updatedAt: DateTime.UtcNow.AddDays(-1),
            deletedAt: DateTime.UtcNow);
        _nodeRepo.GetByIdAsync("tenant-001", "node-1", Arg.Any<CancellationToken>()).Returns(deletedNode);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(
            MakeCommand(deviceType: "Hydrant", hostPipeId: null, hostNodeId: "node-1"), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkDevice.HostNotFound");
    }

    [Fact]
    public async Task Handle_InvalidHostShape_Throws_DomainException_Before_Repo_Lookup()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);

        var handler = CreateHandler();
        // Valve with a hostNodeId → DeviceHost.HostNotAllowed; pipe/node repos must NOT be called
        var act = () => handler.HandleAsync(
            MakeCommand(hostPipeId: "pipe-1", hostNodeId: "node-1"), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<DomainException>();
        ex.Which.Code.Should().Contain("DeviceHost.HostNotAllowed");
        await _pipeRepo.DidNotReceive().GetByIdAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await _nodeRepo.DidNotReceive().GetByIdAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_DuplicateAssetCode_Throws_ConflictException()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(true);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<ConflictException>();
        ex.Which.Code.Should().Be("CONFLICT");
    }

    [Fact]
    public async Task Handle_Throws_When_Tenant_Missing()
    {
        _tenantAccessor.Current.Returns((TenantContext?)null);
        var handler = new InstallDeviceCommandHandler(_deviceRepo, _pipeRepo, _nodeRepo, _tenantAccessor);

        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        await act.Should().ThrowAsync<UnauthorizedException>();
    }

    [Fact]
    public async Task Handle_InvalidDeviceType_Throws_DomainException()
    {
        _deviceRepo.ExistsByAssetCodeAsync("tenant-001", "DV-001", Arg.Any<CancellationToken>()).Returns(false);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(deviceType: "Sprinkler"), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<DomainException>();
        ex.Which.Code.Should().Be("DeviceType.Invalid");
    }
}
