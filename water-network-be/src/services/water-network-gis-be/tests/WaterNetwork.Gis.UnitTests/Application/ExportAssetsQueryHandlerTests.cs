using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Application.Queries;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class ExportAssetsQueryHandlerTests
{
    private readonly IExportAssetReadDao _dao = Substitute.For<IExportAssetReadDao>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();

    private static AssetExportItemDto NodeItem(string id) =>
        new("Node", id, "ND-1", "Junction", null, null, null, null, null, null, null, null);

    private ExportAssetsQueryHandler CreateHandler() => new(_dao, _tenant);

    [Fact]
    public async Task No_Tenant_Throws_Unauthorized()
    {
        _tenant.Current.Returns((TenantContext?)null);
        var act = () => CreateHandler().HandleAsync(new ExportAssetsQuery(null, 10), CancellationToken.None);
        await act.Should().ThrowAsync<UnauthorizedException>();
    }

    [Fact]
    public async Task Fetches_Limit_Plus_One()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync("tenant-001", null, 11, Arg.Any<CancellationToken>())
            .Returns([NodeItem("n1")]);

        await CreateHandler().HandleAsync(new ExportAssetsQuery(null, 10), CancellationToken.None);

        await _dao.Received(1).QueryAsync("tenant-001", null, 11, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Returns_Limit_Items_And_NextCursor_When_More_Rows()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        // limit=2, DAO returns limit+1=3 rows -> hasMore
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<string?>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeItem("n1"), NodeItem("n2"), NodeItem("n3")]);

        var result = await CreateHandler().HandleAsync(new ExportAssetsQuery(null, 2), CancellationToken.None);

        result.Items.Should().HaveCount(2);
        result.Items.Select(i => i.Id).Should().Equal("n1", "n2");
        result.NextCursor.Should().Be("n2"); // last *returned* item's id
    }

    [Fact]
    public async Task NextCursor_Null_When_Rows_Within_Limit()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync(Arg.Any<string>(), Arg.Any<string?>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns([NodeItem("n1"), NodeItem("n2")]);

        var result = await CreateHandler().HandleAsync(new ExportAssetsQuery(null, 5), CancellationToken.None);

        result.Items.Should().HaveCount(2);
        result.NextCursor.Should().BeNull();
    }

    [Fact]
    public async Task Passes_Cursor_Through_To_Dao()
    {
        _tenant.Current.Returns(new TenantContext("tenant-001"));
        _dao.QueryAsync("tenant-001", "n5", 4, Arg.Any<CancellationToken>())
            .Returns([NodeItem("n6")]);

        await CreateHandler().HandleAsync(new ExportAssetsQuery("n5", 3), CancellationToken.None);

        await _dao.Received(1).QueryAsync("tenant-001", "n5", 4, Arg.Any<CancellationToken>());
    }
}
