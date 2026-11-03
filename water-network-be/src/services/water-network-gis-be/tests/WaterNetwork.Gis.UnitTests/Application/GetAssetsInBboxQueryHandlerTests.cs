using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class GetAssetsInBboxQueryHandlerTests
{
    private readonly IBboxAssetReadDao _dao = Substitute.For<IBboxAssetReadDao>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    private static GetAssetsInBboxQuery MakeQuery(int limit) =>
        new(106.6, 10.7, 106.7, 10.8, ["node", "pipe", "device"], limit);

    private static BboxAssetRow NodeRow(string id) =>
        new("Node", id, "ND-1", "Active", "{\"type\":\"Point\",\"coordinates\":[106.66,10.76]}",
            "Junction", null, null, null, null, null, null, null, null, null);

    private GetAssetsInBboxQueryHandler CreateHandler() => new(_dao, _tenant);

    [Fact]
    public async Task No_Tenant_Throws_Unauthorized()
    {
        _tenant.Current.Returns((TenantContext?)null);
        var act = () => CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);
        await act.Should().ThrowAsync<UnauthorizedException>();
    }

    [Fact]
    public async Task Fetches_Limit_Plus_One()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync("tenant-001", Arg.Any<GetAssetsInBboxQuery>(), 11, Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1")]);

        await CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);

        await _dao.Received(1).QueryAsync("tenant-001", Arg.Any<GetAssetsInBboxQuery>(), 11, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Maps_Row_To_Feature()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<GetAssetsInBboxQuery>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1")]);

        var result = await CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);

        result.Type.Should().Be("FeatureCollection");
        result.Features.Should().HaveCount(1);
        var f = result.Features[0];
        f.Id.Should().Be("n1");
        f.Type.Should().Be("Feature");
        f.Geometry["type"]!.GetValue<string>().Should().Be("Point");
        f.Properties.Kind.Should().Be("Node");
        f.Properties.LifecycleStatus.Should().BeNull();
    }

    [Fact]
    public async Task Not_Truncated_When_Rows_Within_Limit()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<GetAssetsInBboxQuery>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1"), NodeRow("n2")]);

        var result = await CreateHandler().HandleAsync(MakeQuery(10), CancellationToken.None);

        result.Truncated.Should().BeFalse();
        result.Features.Should().HaveCount(2);
    }

    [Fact]
    public async Task Truncated_When_Rows_Exceed_Limit_And_Extra_Dropped()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<GetAssetsInBboxQuery>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeRow("n1"), NodeRow("n2"), NodeRow("n3")]);

        var result = await CreateHandler().HandleAsync(MakeQuery(2), CancellationToken.None);

        result.Truncated.Should().BeTrue();
        result.Features.Should().HaveCount(2);
    }
}
