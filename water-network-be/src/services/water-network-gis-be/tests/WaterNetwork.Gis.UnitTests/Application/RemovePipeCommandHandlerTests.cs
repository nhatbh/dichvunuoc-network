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

public class RemovePipeCommandHandlerTests
{
    private readonly INetworkPipeRepository _pipeRepo = Substitute.For<INetworkPipeRepository>();
    private readonly INetworkDeviceRepository _deviceRepo = Substitute.For<INetworkDeviceRepository>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    private static NetworkPipe MakePipe() =>
        NetworkPipe.Register("tenant-001", new AssetCode("PP-001"), "node-a", "node-b",
            new PipeGeometry(new[] { new GeoPoint(10.0, 106.0), new GeoPoint(10.1, 106.1) }),
            new Diameter(150), PipeMaterial.Parse("HDPE"), 100.0, null);

    private RemovePipeCommandHandler CreateHandler()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        return new(_pipeRepo, _deviceRepo, _tenant);
    }

    // 1. Happy path: pipe exists, no attached devices → DeleteAsync called.
    [Fact]
    public async Task Handle_PipeExists_NoDevices_Calls_DeleteAsync()
    {
        var pipe = MakePipe();
        _pipeRepo.GetByIdAsync("tenant-001", pipe.Id, Arg.Any<CancellationToken>()).Returns(pipe);
        _deviceRepo.ExistsByHostPipeAsync(pipe.Id, Arg.Any<CancellationToken>()).Returns(false);

        var handler = CreateHandler();
        await handler.HandleAsync(new RemovePipeCommand(pipe.Id), CancellationToken.None);

        await _pipeRepo.Received(1).DeleteAsync(pipe.Id, Arg.Any<CancellationToken>());
    }

    // 2. Pipe missing → NotFoundException; DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_PipeMissing_Throws_NotFoundException_And_Does_Not_Delete()
    {
        _pipeRepo.GetByIdAsync("tenant-001", "pipe-missing", Arg.Any<CancellationToken>()).Returns((NetworkPipe?)null);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(new RemovePipeCommand("pipe-missing"), CancellationToken.None);

        await act.Should().ThrowAsync<NotFoundException>();
        await _pipeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // 3. ExistsByHostPipe → true → BusinessRuleException "NetworkPipe.HasAttachedDevices"; DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_HasAttachedDevices_Throws_BusinessRuleException_And_Does_Not_Delete()
    {
        var pipe = MakePipe();
        _pipeRepo.GetByIdAsync("tenant-001", pipe.Id, Arg.Any<CancellationToken>()).Returns(pipe);
        _deviceRepo.ExistsByHostPipeAsync(pipe.Id, Arg.Any<CancellationToken>()).Returns(true);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(new RemovePipeCommand(pipe.Id), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkPipe.HasAttachedDevices");
        await _pipeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // 4. Cross-tenant: pipe owned by another tenant → NotFound, DeleteAsync DidNotReceive.
    [Fact]
    public async Task Handle_Pipe_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Delete()
    {
        var pipe = MakePipe();
        _pipeRepo.GetByIdAsync("tenant-999", pipe.Id, Arg.Any<CancellationToken>()).Returns(pipe);

        var handler = CreateHandler();
        await handler.Invoking(h => h.HandleAsync(new RemovePipeCommand(pipe.Id), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
        await _pipeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }
}
