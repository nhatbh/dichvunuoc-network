using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Incident.Infrastructure.Persistence;

public sealed class IncidentDbContext(DbContextOptions<IncidentDbContext> options) : PlatformDbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(IncidentDbContext).Assembly);
    }
}
