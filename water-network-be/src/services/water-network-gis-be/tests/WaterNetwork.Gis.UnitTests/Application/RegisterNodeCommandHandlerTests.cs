using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NSubstitute;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RegisterNodeCommandHandlerTests
{
    private readonly INetworkNodeRepository _repository = Substitute.For<INetworkNodeRepository>();
    private readonly ITenantContextAccessor _tenantAccessor = Substitute.For<ITenantContextAccessor>();
    private readonly IGeometryVersionStore _geometryVersionStore = Substitute.For<IGeometryVersionStore>();
    private readonly IRequestContextProvider _requestContextProvider = Substitute.For<IRequestContextProvider>();

    private RegisterNodeCommandHandler CreateHandler()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        _repository.SaveAsync(Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<NetworkNode>());
        _geometryVersionStore.GetNextVersionAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(1);
        _requestContextProvider.Current().Returns((RequestContext?)null);
        return new RegisterNodeCommandHandler(_repository, _tenantAccessor, _geometryVersionStore, _requestContextProvider);
    }

    [Fact]
    public async Task Handle_Registers_Node_And_Returns_Id()
    {
        _repository.ExistsByAssetCodeAsync("tenant-001", "ND-001", Arg.Any<CancellationToken>()).Returns(false);
        var handler = CreateHandler();

        var id = await handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.762622, 106.660172), CancellationToken.None);

        id.Should().StartWith("node-");
        await _repository.Received(1).SaveAsync(
            Arg.Is<NetworkNode>(n => n.AssetCode.Value == "ND-001" && n.TenantId == "tenant-001"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_Registers_Node_Appends_GeometryVersion_V1()
    {
        _repository.ExistsByAssetCodeAsync("tenant-001", "ND-001", Arg.Any<CancellationToken>()).Returns(false);
        var handler = CreateHandler();

        var id = await handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.762622, 106.660172), CancellationToken.None);

        id.Should().StartWith("node-");
        await _geometryVersionStore.Received(1).AppendAsync(
            Arg.Is<GeometryVersion>(v =>
                v.Version == 1
                && v.GeoJson.Contains("106.660172")
                && v.GeoJson.Contains("10.762622")),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_Throws_Conflict_When_AssetCode_Exists()
    {
        _repository.ExistsByAssetCodeAsync("tenant-001", "ND-001", Arg.Any<CancellationToken>()).Returns(true);
        var handler = CreateHandler();

        var act = () => handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.7, 106.6), CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<ConflictException>();
        assertion.Which.Code.Should().Be("CONFLICT");
    }

    [Fact]
    public async Task Handle_Throws_When_Tenant_Missing()
    {
        _tenantAccessor.Current.Returns((TenantContext?)null);
        var handler = new RegisterNodeCommandHandler(_repository, _tenantAccessor, _geometryVersionStore, _requestContextProvider);

        var act = () => handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.7, 106.6), CancellationToken.None);

        await act.Should().ThrowAsync<UnauthorizedException>();
    }

    [Fact]
    public async Task Handle_Translates_DbUpdate_Unique_Violation_To_ConflictException()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        _repository.ExistsByAssetCodeAsync("tenant-001", "ND-001", Arg.Any<CancellationToken>()).Returns(false);
        _geometryVersionStore.GetNextVersionAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(1);
        var pgEx = new PostgresException("duplicate key value violates unique constraint", "ERROR", "ERROR", "23505");
        _repository.SaveAsync(Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>())
            .Returns<Task<NetworkNode>>(_ => throw new DbUpdateException("save failed", pgEx));
        var handler = new RegisterNodeCommandHandler(_repository, _tenantAccessor, _geometryVersionStore, _requestContextProvider);

        var act = () => handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.7, 106.6), CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<ConflictException>();
        assertion.Which.Code.Should().Be("CONFLICT");
    }

    [Fact]
    public async Task Handle_Uses_UserId_As_ChangedBy_When_RequestContext_Has_UserId()
    {
        _repository.ExistsByAssetCodeAsync("tenant-001", "ND-001", Arg.Any<CancellationToken>()).Returns(false);
        var handler = CreateHandler();
        // Override the default null context set by CreateHandler with a real UserId.
        _requestContextProvider.Current().Returns(
            new RequestContext(CorrelationId: "corr-1", UserId: "user-abc"));

        await handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.762622, 106.660172), CancellationToken.None);

        await _geometryVersionStore.Received(1).AppendAsync(
            Arg.Is<GeometryVersion>(v => v.ChangedBy == "user-abc"),
            Arg.Any<CancellationToken>());
    }
}
