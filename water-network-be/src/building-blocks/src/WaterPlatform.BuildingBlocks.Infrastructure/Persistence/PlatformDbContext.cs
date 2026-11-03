using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public abstract class PlatformDbContext : DbContext
{
    protected PlatformDbContext(DbContextOptions options) : base(options) { }

    public DbSet<OutboxEntry> OutboxEntries => Set<OutboxEntry>();
    public DbSet<IdempotencyEntry> IdempotencyEntries => Set<IdempotencyEntry>();
    public DbSet<ProcessedEventEntry> ProcessedEvents => Set<ProcessedEventEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PlatformDbContext).Assembly);
    }
}
