using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.UnitTests.Application;

public sealed class AssetCodeExistsQueryHandlerTests
{
    private readonly INetworkNodeRepository _nodes = Substitute.For<INetworkNodeRepository>();
    private readonly INetworkPipeRepository _pipes = Substitute.For<INetworkPipeRepository>();
    private readonly INetworkDeviceRepository _devices = Substitute.For<INetworkDeviceRepository>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    [Fact]
    public async Task Requires_A_Tenant_Context()
    {
        _tenant.Current.Returns((TenantContext?)null);

        var act = () => CreateHandler().HandleAsync(
            new AssetCodeExistsQuery("PIPE-1"), CancellationToken.None);

        await act.Should().ThrowAsync<UnauthorizedException>();
    }

    [Fact]
    public async Task Searches_All_Asset_Kinds_In_The_Resolved_Tenant()
    {
        _tenant.Current.Returns(new TenantContext("tenant-1"));
        _nodes.ExistsByAssetCodeAsync("tenant-1", "PIPE-1", Arg.Any<CancellationToken>())
            .Returns(false);
        _pipes.ExistsByAssetCodeAsync("tenant-1", "PIPE-1", Arg.Any<CancellationToken>())
            .Returns(false);
        _devices.ExistsByAssetCodeAsync("tenant-1", "PIPE-1", Arg.Any<CancellationToken>())
            .Returns(true);

        var result = await CreateHandler().HandleAsync(
            new AssetCodeExistsQuery("  PIPE-1  "), CancellationToken.None);

        result.Should().BeTrue();
        await _nodes.Received(1).ExistsByAssetCodeAsync("tenant-1", "PIPE-1", Arg.Any<CancellationToken>());
        await _pipes.Received(1).ExistsByAssetCodeAsync("tenant-1", "PIPE-1", Arg.Any<CancellationToken>());
        await _devices.Received(1).ExistsByAssetCodeAsync("tenant-1", "PIPE-1", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Stops_After_The_First_Match()
    {
        _tenant.Current.Returns(new TenantContext("tenant-1"));
        _nodes.ExistsByAssetCodeAsync("tenant-1", "NODE-1", Arg.Any<CancellationToken>())
            .Returns(true);

        var result = await CreateHandler().HandleAsync(
            new AssetCodeExistsQuery("NODE-1"), CancellationToken.None);

        result.Should().BeTrue();
        await _pipes.DidNotReceiveWithAnyArgs().ExistsByAssetCodeAsync(default!, default!);
        await _devices.DidNotReceiveWithAnyArgs().ExistsByAssetCodeAsync(default!, default!);
    }

    private AssetCodeExistsQueryHandler CreateHandler() =>
        new(_nodes, _pipes, _devices, _tenant);
}
