using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NSubstitute;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RelocateNodeCommandHandlerTests
{
    private readonly INetworkNodeRepository _nodeRepository = Substitute.For<INetworkNodeRepository>();
    private readonly IGeometryVersionStore _geometryVersionStore = Substitute.For<IGeometryVersionStore>();
    private readonly ITenantContextAccessor _tenantAccessor = Substitute.For<ITenantContextAccessor>();
    private readonly IRequestContextProvider _requestContextProvider = Substitute.For<IRequestContextProvider>();

    private static NetworkNode MakeNode(double lat = 10.0, double lng = 106.0)
        => NetworkNode.Register("tenant-001", new AssetCode("ND-001"), NodeType.Junction, new GeoPoint(lat, lng));

    private RelocateNodeCommandHandler CreateHandler()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        _nodeRepository.SaveAsync(Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<NetworkNode>());
        _requestContextProvider.Current().Returns((RequestContext?)null);
        return new RelocateNodeCommandHandler(_nodeRepository, _geometryVersionStore, _tenantAccessor, _requestContextProvider);
    }

    // 1. Happy path: node exists → handler loads it, calls Relocate, GetNextVersion → n,
    //    AppendAsync(version=n, geoJson containing new coords), SaveAsync(node).
    [Fact]
    public async Task Handle_Happy_Path_Relocates_Node_Appends_GeometryVersion_And_Returns_Id()
    {
        var node = MakeNode(lat: 10.0, lng: 106.0);
        _nodeRepository.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);
        _geometryVersionStore.GetNextVersionAsync(node.Id, Arg.Any<CancellationToken>()).Returns(1);

        var handler = CreateHandler();
        var command = new RelocateNodeCommand(node.Id, Latitude: 10.5, Longitude: 106.5, Reason: "survey fix");

        var result = await handler.HandleAsync(command, CancellationToken.None);

        result.Should().Be(node.Id);
        result.Should().StartWith("node-");

        await _geometryVersionStore.Received(1).AppendAsync(
            Arg.Is<GeometryVersion>(v =>
                v.Version == 1
                && v.GeoJson.Contains("10.5")
                && v.GeoJson.Contains("106.5")),
            Arg.Any<CancellationToken>());

        await _nodeRepository.Received(1).SaveAsync(
            Arg.Is<NetworkNode>(n => n.Id == node.Id),
            Arg.Any<CancellationToken>());
    }

    // 2. Node missing (GetById → null) → NotFoundException; AppendAsync/SaveAsync DidNotReceive.
    [Fact]
    public async Task Handle_Node_Missing_Throws_NotFoundException_And_Does_Not_Append_Or_Save()
    {
        _nodeRepository.GetByIdAsync("tenant-001", "node-missing", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);

        var handler = CreateHandler();
        var command = new RelocateNodeCommand("node-missing", 10.5, 106.5, null);

        var act = () => handler.HandleAsync(command, CancellationToken.None);

        await act.Should().ThrowAsync<NotFoundException>();

        await _geometryVersionStore.DidNotReceive().AppendAsync(
            Arg.Any<GeometryVersion>(), Arg.Any<CancellationToken>());
        await _nodeRepository.DidNotReceive().SaveAsync(
            Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>());
    }

    // 3. Relocate to same location → DomainException NoLocationChange propagates; AppendAsync DidNotReceive.
    [Fact]
    public async Task Handle_Same_Location_Throws_DomainException_NoLocationChange_And_Does_Not_Append()
    {
        var node = MakeNode(lat: 10.5, lng: 106.5);
        _nodeRepository.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);

        var handler = CreateHandler();
        // Same location as the node's current location
        var command = new RelocateNodeCommand(node.Id, Latitude: 10.5, Longitude: 106.5, Reason: null);

        var act = () => handler.HandleAsync(command, CancellationToken.None);

        var ex = await act.Should().ThrowAsync<DomainException>();
        ex.Which.Code.Should().Be("NetworkNode.NoLocationChange");

        await _geometryVersionStore.DidNotReceive().AppendAsync(
            Arg.Any<GeometryVersion>(), Arg.Any<CancellationToken>());
    }

    // 4. GetNextVersion returns 2 (v1 already exists) → AppendAsync version == 2.
    [Fact]
    public async Task Handle_GetNextVersion_Returns_2_AppendAsync_Receives_Version_2()
    {
        var node = MakeNode(lat: 10.0, lng: 106.0);
        _nodeRepository.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);
        _geometryVersionStore.GetNextVersionAsync(node.Id, Arg.Any<CancellationToken>()).Returns(2);

        var handler = CreateHandler();
        var command = new RelocateNodeCommand(node.Id, Latitude: 10.9, Longitude: 106.9, Reason: null);

        await handler.HandleAsync(command, CancellationToken.None);

        await _geometryVersionStore.Received(1).AppendAsync(
            Arg.Is<GeometryVersion>(v => v.Version == 2),
            Arg.Any<CancellationToken>());
    }

    // 5. When RequestContext carries a UserId, ChangedBy equals that UserId.
    [Fact]
    public async Task Handle_Uses_UserId_As_ChangedBy_When_RequestContext_Has_UserId()
    {
        var node = MakeNode(lat: 10.0, lng: 106.0);
        _nodeRepository.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);
        _geometryVersionStore.GetNextVersionAsync(node.Id, Arg.Any<CancellationToken>()).Returns(1);

        var handler = CreateHandler();
        // Override the default null context set by CreateHandler with a real UserId.
        _requestContextProvider.Current().Returns(
            new RequestContext(CorrelationId: "corr-1", UserId: "user-xyz"));
        var command = new RelocateNodeCommand(node.Id, Latitude: 10.5, Longitude: 106.5, Reason: null);

        await handler.HandleAsync(command, CancellationToken.None);

        await _geometryVersionStore.Received(1).AppendAsync(
            Arg.Is<GeometryVersion>(v => v.ChangedBy == "user-xyz"),
            Arg.Any<CancellationToken>());
    }

    // 6. Race-condition: concurrent double-relocate fires 23505 unique violation on SaveAsync
    //    → handler translates to ConflictException (not a raw 500).
    [Fact]
    public async Task Handle_Translates_DbUpdate_Unique_Violation_To_ConflictException()
    {
        var node = MakeNode(lat: 10.0, lng: 106.0);
        _nodeRepository.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);
        _geometryVersionStore.GetNextVersionAsync(node.Id, Arg.Any<CancellationToken>()).Returns(2);
        _geometryVersionStore.AppendAsync(Arg.Any<GeometryVersion>(), Arg.Any<CancellationToken>())
            .Returns(Task.CompletedTask);

        // CreateHandler sets the default SaveAsync return; we override it AFTER to simulate the race.
        var handler = CreateHandler();

        var pgEx = new PostgresException(
            "duplicate key value violates unique constraint", "ERROR", "ERROR", "23505");
        _nodeRepository.SaveAsync(Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>())
            .Returns<Task<NetworkNode>>(_ => throw new DbUpdateException("save failed", pgEx));

        var command = new RelocateNodeCommand(node.Id, Latitude: 10.5, Longitude: 106.5, Reason: null);

        var act = () => handler.HandleAsync(command, CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<ConflictException>();
        assertion.Which.Code.Should().Be("CONFLICT");
    }

    // 7. Cross-tenant: node belongs to another tenant → overload returns null → NotFound, no Save.
    [Fact]
    public async Task Handle_Node_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Save()
    {
        var node = MakeNode();
        // Overload stubbed ONLY for the owning tenant; caller is "tenant-001" → no match → null.
        _nodeRepository.GetByIdAsync("tenant-999", node.Id, Arg.Any<CancellationToken>()).Returns(node);

        var handler = CreateHandler();
        var command = new RelocateNodeCommand(node.Id, 10.5, 106.5, null);

        await handler.Invoking(h => h.HandleAsync(command, CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
        await _geometryVersionStore.DidNotReceive().AppendAsync(Arg.Any<GeometryVersion>(), Arg.Any<CancellationToken>());
        await _nodeRepository.DidNotReceive().SaveAsync(Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>());
    }
}
