using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Tests.Outbox;

/// <summary>
/// Minimal in-memory PlatformDbContext subclass for outbox unit tests.
/// </summary>
internal sealed class OutboxTestDbContext : PlatformDbContext
{
    private OutboxTestDbContext(DbContextOptions<OutboxTestDbContext> options) : base(options) { }

    public static OutboxTestDbContext InMemory() =>
        new(new DbContextOptionsBuilder<OutboxTestDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);
}
