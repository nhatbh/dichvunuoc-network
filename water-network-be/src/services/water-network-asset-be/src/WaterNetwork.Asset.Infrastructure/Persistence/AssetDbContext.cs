using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class AssetDbContext(DbContextOptions<AssetDbContext> options) : PlatformDbContext(options)
{
    public DbSet<NetworkAssetPersistenceModel> NetworkAssets => Set<NetworkAssetPersistenceModel>();
    public DbSet<AssetLifecycleEntryPersistenceModel> AssetLifecycleEntries => Set<AssetLifecycleEntryPersistenceModel>();
    public DbSet<AssetTechnicalProfilePersistenceModel> AssetTechnicalProfiles => Set<AssetTechnicalProfilePersistenceModel>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AssetDbContext).Assembly);
    }
}
