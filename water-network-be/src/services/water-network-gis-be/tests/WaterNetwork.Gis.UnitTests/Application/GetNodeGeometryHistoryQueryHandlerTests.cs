using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class GetNodeGeometryHistoryQueryHandlerTests
{
    private readonly IGeometryVersionReadDao _geometryReadDao = Substitute.For<IGeometryVersionReadDao>();
    private readonly INodeReadDao _nodeReadDao = Substitute.For<INodeReadDao>();
    private readonly ITenantContextAccessor _tenantAccessor = Substitute.For<ITenantContextAccessor>();

    private GetNodeGeometryHistoryQueryHandler CreateHandler()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        return new GetNodeGeometryHistoryQueryHandler(_geometryReadDao, _nodeReadDao, _tenantAccessor);
    }

    // 1. Owner tenant: node belongs to this tenant → history returned, geometry DAO called once.
    [Fact]
    public async Task Handle_NodeBelongsToCallerTenant_ReturnsHistory()
    {
        var nodeId = "node-abc";
        var nodeDto = new NodeDetailDto(nodeId, "ND-001", "Junction", 10.0, 106.0, 1,
            DateTime.UtcNow, DateTime.UtcNow);
        _nodeReadDao.GetByIdAsync("tenant-001", nodeId, Arg.Any<CancellationToken>())
            .Returns(nodeDto);

        var history = new List<GeometryVersionDto>
        {
            new(Version: 1, GeoJson: "{}", ChangedBy: null, Reason: null, ChangedAt: DateTime.UtcNow)
        };
        _geometryReadDao.ListByAssetAsync(nodeId, Arg.Any<CancellationToken>())
            .Returns((IReadOnlyList<GeometryVersionDto>)history);

        var handler = CreateHandler();
        var result = await handler.HandleAsync(new GetNodeGeometryHistoryQuery(nodeId), CancellationToken.None);

        result.Should().HaveCount(1);
        await _geometryReadDao.Received(1).ListByAssetAsync(nodeId, Arg.Any<CancellationToken>());
    }

    // 2. Cross-tenant IDOR: node id belongs to a different tenant (node read DAO returns null) → 404.
    //    The geometry read DAO must NOT be called at all.
    [Fact]
    public async Task Handle_NodeNotOwnedByCallerTenant_Throws_NotFoundException_And_Does_Not_Call_GeometryDao()
    {
        var nodeId = "node-other-tenant";
        // The node read DAO returns null when the (tenant, id) combination doesn't match.
        _nodeReadDao.GetByIdAsync("tenant-001", nodeId, Arg.Any<CancellationToken>())
            .Returns((NodeDetailDto?)null);

        var handler = CreateHandler();
        var act = () => handler.HandleAsync(new GetNodeGeometryHistoryQuery(nodeId), CancellationToken.None);

        await act.Should().ThrowAsync<NotFoundException>();

        // Geometry DAO must not have been called — that would be the IDOR leak.
        await _geometryReadDao.DidNotReceive().ListByAssetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // 3. No tenant token → UnauthorizedException (existing guard, remains intact).
    [Fact]
    public async Task Handle_NoTenantToken_Throws_UnauthorizedException()
    {
        _tenantAccessor.Current.Returns((TenantContext?)null);
        var handler = new GetNodeGeometryHistoryQueryHandler(_geometryReadDao, _nodeReadDao, _tenantAccessor);

        var act = () => handler.HandleAsync(new GetNodeGeometryHistoryQuery("node-x"), CancellationToken.None);

        await act.Should().ThrowAsync<UnauthorizedException>();
    }
}
