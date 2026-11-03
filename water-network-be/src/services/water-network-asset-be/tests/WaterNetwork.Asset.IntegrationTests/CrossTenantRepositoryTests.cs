using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Asset.IntegrationTests;

public class CrossTenantRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task AssetRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();

        var id = $"node-{Guid.CreateVersion7():N}";
        var asset = NetworkAsset.RegisterFromGis(id, "tenant-A", AssetType.Node, $"ND-{id[^8..]}");
        await repo.SaveAsync(asset);

        (await repo.GetByIdAsync("tenant-A", id)).Should().NotBeNull();
        (await repo.GetByIdAsync("tenant-B", id)).Should().BeNull();
    }
}
