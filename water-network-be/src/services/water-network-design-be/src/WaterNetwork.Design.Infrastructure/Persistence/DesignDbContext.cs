using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignDbContext(DbContextOptions<DesignDbContext> options) : PlatformDbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(DesignDbContext).Assembly);
    }
}
