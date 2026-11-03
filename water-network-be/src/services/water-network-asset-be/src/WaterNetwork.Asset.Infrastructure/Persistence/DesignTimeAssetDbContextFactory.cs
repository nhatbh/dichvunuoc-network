using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class DesignTimeAssetDbContextFactory : IDesignTimeDbContextFactory<AssetDbContext>
{
    public AssetDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AssetDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_asset;Username=postgres;Password=postgres")
            .Options;
        return new AssetDbContext(options);
    }
}
