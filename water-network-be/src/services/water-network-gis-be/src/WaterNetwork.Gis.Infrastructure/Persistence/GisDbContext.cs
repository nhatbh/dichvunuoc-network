using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class GisDbContext(DbContextOptions<GisDbContext> options) : PlatformDbContext(options)
{
    public DbSet<NetworkNodePersistenceModel> NetworkNodes => Set<NetworkNodePersistenceModel>();
    public DbSet<NetworkPipePersistenceModel> NetworkPipes => Set<NetworkPipePersistenceModel>();
    public DbSet<NetworkDevicePersistenceModel> NetworkDevices => Set<NetworkDevicePersistenceModel>();
    public DbSet<GeometryVersionPersistenceModel> GeometryVersions => Set<GeometryVersionPersistenceModel>();
    public DbSet<AssetStatePersistenceModel> NetworkAssetStates => Set<AssetStatePersistenceModel>();
    public DbSet<GisImportLedgerPersistenceModel> GisImportLedger => Set<GisImportLedgerPersistenceModel>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(GisDbContext).Assembly);
    }
}
