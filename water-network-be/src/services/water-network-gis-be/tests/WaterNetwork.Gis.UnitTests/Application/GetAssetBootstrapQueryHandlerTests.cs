using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.UnitTests.Application;

public sealed class GetAssetBootstrapQueryHandlerTests
{
    private readonly IAssetBootstrapReadDao _dao = Substitute.For<IAssetBootstrapReadDao>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    private GetAssetBootstrapQueryHandler CreateHandler() => new(_dao, _tenant);

    [Fact]
    public async Task No_Tenant_Throws_Unauthorized()
    {
        _tenant.Current.Returns((TenantContext?)null);

        var act = () => CreateHandler().HandleAsync(new GetAssetBootstrapQuery(), CancellationToken.None);

        await act.Should().ThrowAsync<UnauthorizedException>();
        await _dao.DidNotReceiveWithAnyArgs().QueryAsync(default!, default);
    }

    [Fact]
    public async Task Uses_Tenant_Context_And_Maps_Data_Extent()
    {
        _tenant.Current.Returns(new TenantContext("tenant-a"));
        _dao.QueryAsync("tenant-a", Arg.Any<CancellationToken>()).Returns(new AssetBootstrapSnapshot(
            Nodes: 2,
            Pipes: 1,
            Devices: 1,
            PipeLengthM: 125.5,
            MinLon: 105.1,
            MinLat: 20.2,
            MaxLon: 106.3,
            MaxLat: 21.4,
            MaterialMix: [new AssetMaterialMixRow("HDPE", 1, 125.5)],
            StatusMix: [new AssetStatusMixRow("Active", 1)]));

        var result = await CreateHandler().HandleAsync(new GetAssetBootstrapQuery(), CancellationToken.None);

        result.SchemaVersion.Should().Be(1);
        result.HasData.Should().BeTrue();
        result.Counts.Total.Should().Be(4);
        result.HomeView!.Bbox.Should().Equal(105.1, 20.2, 106.3, 21.4);
        result.HomeView.Center.Lon.Should().BeApproximately(105.7, 0.0000001);
        result.HomeView.Center.Lat.Should().BeApproximately(20.8, 0.0000001);
        result.HomeView.Source.Should().Be("data_extent");
        result.MaterialMix.Should().ContainSingle().Which.Material.Should().Be("HDPE");
        result.StatusMix.Should().ContainSingle().Which.Count.Should().Be(1);
        await _dao.Received(1).QueryAsync("tenant-a", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Empty_Tenant_Has_No_Home_View_And_Zero_Aggregates()
    {
        _tenant.Current.Returns(new TenantContext("tenant-empty"));
        _dao.QueryAsync("tenant-empty", Arg.Any<CancellationToken>()).Returns(new AssetBootstrapSnapshot(
            0, 0, 0, 0, null, null, null, null, [], []));

        var result = await CreateHandler().HandleAsync(new GetAssetBootstrapQuery(), CancellationToken.None);

        result.HasData.Should().BeFalse();
        result.HomeView.Should().BeNull();
        result.Counts.Should().BeEquivalentTo(new { Nodes = 0L, Pipes = 0L, Devices = 0L, Total = 0L });
        result.PipeLengthM.Should().Be(0);
        result.MaterialMix.Should().BeEmpty();
        result.StatusMix.Should().BeEmpty();
    }
}
