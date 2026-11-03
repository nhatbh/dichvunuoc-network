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

public class RemoveNodeCommandHandlerTests
{
    private readonly INetworkNodeRepository _nodeRepo = Substitute.For<INetworkNodeRepository>();
    private readonly INetworkPipeRepository _pipeRepo = Substitute.For<INetworkPipeRepository>();
    private readonly INetworkDeviceRepository _deviceRepo = Substitute.For<INetworkDeviceRepository>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    private static NetworkNode MakeNode() =>
        NetworkNode.Register("tenant-001", new AssetCode("ND-001"), NodeType.Junction, new GeoPoint(10.0, 106.0));

    private RemoveNodeCommandHandler CreateHandler()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        return new(_nodeRepo, _pipeRepo, _deviceRepo, _tenant);
    }

    // 1. Happy path: node exists, no connected pipes, no attached devices → DeleteAsync called.
    [Fact]
    public async Task Handle_NodeExists_NoPipes_NoDevices_Calls_DeleteAsync()
    {
        var node = MakeNode();
        _nodeRepo.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);
        _pipeRepo.ExistsByEndpointNodeAsync(node.Id, Arg.Any<CancellationToken>()).Returns(false);
        _deviceRepo.ExistsByHostNodeAsync(node.Id, Arg.Any<CancellationToken>()).Returns(false);

        var handler = CreateHandler();
        await handler.HandleAsync(new RemoveNodeCommand(node.Id), CancellationToken.None);

        await _nodeRepo.Received(1).DeleteAsync(node.Id, Arg.Any<CancellationToken>());
    }

    // 2. Node missing (GetByIdAsync returns null) → NotFoundException; DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_NodeMissing_Throws_NotFoundException_And_Does_Not_Delete()
    {
        _nodeRepo.GetByIdAsync("tenant-001", "node-missing", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(new RemoveNodeCommand("node-missing"), CancellationToken.None);

        await act.Should().ThrowAsync<NotFoundException>();
        await _nodeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // 3. ExistsByEndpointNode → true → BusinessRuleException "NetworkNode.HasConnectedPipes"; DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_HasConnectedPipes_Throws_BusinessRuleException_And_Does_Not_Delete()
    {
        var node = MakeNode();
        _nodeRepo.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);
        _pipeRepo.ExistsByEndpointNodeAsync(node.Id, Arg.Any<CancellationToken>()).Returns(true);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(new RemoveNodeCommand(node.Id), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkNode.HasConnectedPipes");
        await _nodeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // 4. ExistsByHostNode → true → BusinessRuleException "NetworkNode.HasAttachedDevices"; DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_HasAttachedDevices_Throws_BusinessRuleException_And_Does_Not_Delete()
    {
        var node = MakeNode();
        _nodeRepo.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);
        _pipeRepo.ExistsByEndpointNodeAsync(node.Id, Arg.Any<CancellationToken>()).Returns(false);
        _deviceRepo.ExistsByHostNodeAsync(node.Id, Arg.Any<CancellationToken>()).Returns(true);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(new RemoveNodeCommand(node.Id), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkNode.HasAttachedDevices");
        await _nodeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // 5. Cross-tenant: node owned by another tenant → NotFound, DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_Node_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Delete()
    {
        var node = MakeNode();
        _nodeRepo.GetByIdAsync("tenant-999", node.Id, Arg.Any<CancellationToken>()).Returns(node);

        var handler = CreateHandler();
        await handler.Invoking(h => h.HandleAsync(new RemoveNodeCommand(node.Id), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
        await _nodeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }
}
