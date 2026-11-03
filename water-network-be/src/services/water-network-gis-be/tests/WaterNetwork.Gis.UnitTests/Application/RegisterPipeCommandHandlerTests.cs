using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NSubstitute;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RegisterPipeCommandHandlerTests
{
    private readonly INetworkPipeRepository _pipeRepo = Substitute.For<INetworkPipeRepository>();
    private readonly INetworkNodeRepository _nodeRepo = Substitute.For<INetworkNodeRepository>();
    private readonly ITenantContextAccessor _tenantAccessor = Substitute.For<ITenantContextAccessor>();
    private readonly IPipeLengthCalculator _lengthCalculator = Substitute.For<IPipeLengthCalculator>();

    private static readonly IReadOnlyList<(double Lat, double Lng)> TwoPoints =
        new[] { (10.0, 106.0), (10.1, 106.1) };

    private static NetworkNode MakeNode(string id) =>
        NetworkNode.Register("tenant-001", new AssetCode(id), NodeType.Junction, new GeoPoint(10.0, 106.0));

    private RegisterPipeCommandHandler CreateHandler()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        _pipeRepo.SaveAsync(Arg.Any<NetworkPipe>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<NetworkPipe>());
        return new RegisterPipeCommandHandler(_pipeRepo, _nodeRepo, _tenantAccessor, _lengthCalculator);
    }

    private RegisterPipeCommand MakeCommand(double? lengthM = null) =>
        new RegisterPipeCommand(
            AssetCode: "PP-001",
            FromNodeId: "node-from",
            ToNodeId: "node-to",
            Points: TwoPoints,
            DiameterMm: 150,
            Material: "HDPE",
            LengthM: lengthM);

    // -----------------------------------------------------------------------
    // Happy path: both nodes exist, no lengthM provided → calculator value used
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_BothNodesExist_NoLengthM_SavesAndReturnsId()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-FROM"));
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-TO"));
        _lengthCalculator.CalculateMetersAsync(TwoPoints, Arg.Any<CancellationToken>()).Returns(500.0);

        var handler = CreateHandler();
        var id = await handler.HandleAsync(MakeCommand(), CancellationToken.None);

        id.Should().StartWith("pipe-");
        await _pipeRepo.Received(1).SaveAsync(
            Arg.Is<NetworkPipe>(p =>
                p.TenantId == "tenant-001"
                && p.AssetCode.Value == "PP-001"
                && p.LengthM == 500.0
                && p.LengthValidationWarning == null),
            Arg.Any<CancellationToken>());
    }

    // -----------------------------------------------------------------------
    // Happy path: lengthM provided, deviation ≤ 10% → store client value, no warning
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_LengthM_WithinTolerance_StoresClientValue_NoWarning()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-FROM"));
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-TO"));
        _lengthCalculator.CalculateMetersAsync(TwoPoints, Arg.Any<CancellationToken>()).Returns(500.0);

        var handler = CreateHandler();
        // client provides 545 m; deviation = |545-500|/500 = 0.09 = 9% ≤ 10%
        var id = await handler.HandleAsync(MakeCommand(545.0), CancellationToken.None);

        id.Should().StartWith("pipe-");
        await _pipeRepo.Received(1).SaveAsync(
            Arg.Is<NetworkPipe>(p =>
                p.LengthM == 545.0
                && p.LengthValidationWarning == null),
            Arg.Any<CancellationToken>());
    }

    // -----------------------------------------------------------------------
    // Happy path: lengthM provided, deviation > 10% → store client value + warning
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_LengthM_ExceedsTolerance_StoresClientValue_WithWarning()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-FROM"));
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-TO"));
        _lengthCalculator.CalculateMetersAsync(TwoPoints, Arg.Any<CancellationToken>()).Returns(500.0);

        var handler = CreateHandler();
        // client provides 600 m; deviation = |600-500|/500 = 0.20 = 20% > 10%
        var id = await handler.HandleAsync(MakeCommand(600.0), CancellationToken.None);

        id.Should().StartWith("pipe-");
        await _pipeRepo.Received(1).SaveAsync(
            Arg.Is<NetworkPipe>(p =>
                p.LengthM == 600.0
                && p.LengthValidationWarning != null),
            Arg.Any<CancellationToken>());
    }

    // -----------------------------------------------------------------------
    // fromNodeId not found → BusinessRuleException EndpointNotFound
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_FromNode_NotFound_Throws_BusinessRuleException()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-TO"));

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkPipe.EndpointNotFound");
    }

    // -----------------------------------------------------------------------
    // toNodeId not found → BusinessRuleException EndpointNotFound
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_ToNode_NotFound_Throws_BusinessRuleException()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-FROM"));
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkPipe.EndpointNotFound");
    }

    // -----------------------------------------------------------------------
    // Node exists but DeletedAt != null → EndpointNotFound (deleted node)
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_FromNode_Deleted_Throws_BusinessRuleException()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);

        var deletedNode = NetworkNode.Reconstitute(
            id: "node-from-deleted",
            tenantId: "tenant-001",
            assetCode: new AssetCode("ND-DEL"),
            nodeType: NodeType.Junction,
            location: new GeoPoint(10.0, 106.0),
            version: 1,
            createdAt: DateTime.UtcNow.AddDays(-1),
            updatedAt: DateTime.UtcNow.AddDays(-1),
            deletedAt: DateTime.UtcNow);

        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns(deletedNode);
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-TO"));

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<BusinessRuleException>();
        ex.Which.Code.Should().Contain("NetworkPipe.EndpointNotFound");
    }

    // -----------------------------------------------------------------------
    // Calculator returns 0 → store client value, no Infinity/NaN warning
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_CalculatedLengthZero_StoresClientValue_WithoutGarbageWarning()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);
        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-FROM"));
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns(MakeNode("ND-TO"));
        // Calculator returns 0 — division would produce Infinity or NaN without the guard.
        _lengthCalculator.CalculateMetersAsync(TwoPoints, Arg.Any<CancellationToken>()).Returns(0.0);

        var handler = CreateHandler();
        var id = await handler.HandleAsync(MakeCommand(200.0), CancellationToken.None);

        id.Should().StartWith("pipe-");
        await _pipeRepo.Received(1).SaveAsync(
            Arg.Is<NetworkPipe>(p =>
                p.LengthM == 200.0
                && p.LengthValidationWarning == null),
            Arg.Any<CancellationToken>());
    }

    // -----------------------------------------------------------------------
    // Duplicate asset code → ConflictException (pre-check path)
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_DuplicateAssetCode_Throws_ConflictException()
    {
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(true);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var ex = await act.Should().ThrowAsync<ConflictException>();
        ex.Which.Code.Should().Be("CONFLICT");
    }

    // -----------------------------------------------------------------------
    // Backstop: race-condition unique violation (23505) → ConflictException
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Handle_Translates_DbUpdate_Unique_Violation_To_ConflictException()
    {
        // Simulate race: pre-check passes (false), but DB fires 23505 on SaveAsync.
        _pipeRepo.ExistsByAssetCodeAsync("tenant-001", "PP-001", Arg.Any<CancellationToken>()).Returns(false);
        _lengthCalculator.CalculateMetersAsync(Arg.Any<IReadOnlyList<(double Lat, double Lng)>>(), Arg.Any<CancellationToken>()).Returns(100.0);

        var fromNode = MakeNode("node-from");
        var toNode = MakeNode("node-to");
        _nodeRepo.GetByIdAsync("tenant-001", "node-from", Arg.Any<CancellationToken>()).Returns(fromNode);
        _nodeRepo.GetByIdAsync("tenant-001", "node-to", Arg.Any<CancellationToken>()).Returns(toNode);

        var pgEx = new PostgresException("duplicate key value violates unique constraint", "ERROR", "ERROR", "23505");

        var handler = CreateHandler();
        _pipeRepo.SaveAsync(Arg.Any<NetworkPipe>(), Arg.Any<CancellationToken>())
            .Returns<Task<NetworkPipe>>(_ => throw new DbUpdateException("save failed", pgEx));

        var act = () => handler.HandleAsync(MakeCommand(), CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<ConflictException>();
        assertion.Which.Code.Should().Be("CONFLICT");
    }
}
