using Microsoft.EntityFrameworkCore;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public sealed class ProcessedEventStore(PlatformDbContext dbContext) : IProcessedEventStore
{
    public async Task<bool> HasBeenProcessedAsync(string projectionName, string eventId, CancellationToken ct = default)
    {
        return await dbContext.Set<ProcessedEventEntry>()
            .AnyAsync(e => e.ProjectionName == projectionName && e.EventId == eventId, ct);
    }

    public async Task MarkAsProcessedAsync(string projectionName, string eventId, CancellationToken ct = default)
    {
        // Pre-check to avoid unnecessary inserts in the happy path.
        if (await HasBeenProcessedAsync(projectionName, eventId, ct))
        {
            return;
        }

        var entry = new ProcessedEventEntry
        {
            Id = $"{projectionName}:{eventId}",
            ProjectionName = projectionName,
            EventId = eventId,
            ProcessedAt = DateTime.UtcNow
        };

        dbContext.Set<ProcessedEventEntry>().Add(entry);
        try
        {
            await dbContext.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A concurrent processor won the race — unique index prevents duplicates.
            // Treat as already-processed: detach the entity so the context stays clean.
            dbContext.Entry(entry).State = EntityState.Detached;
        }
    }

    public async Task CleanupAsync(string projectionName, DateTime olderThan, CancellationToken ct = default)
    {
        var entries = await dbContext.Set<ProcessedEventEntry>()
            .Where(e => e.ProjectionName == projectionName && e.ProcessedAt < olderThan)
            .ToListAsync(ct);

        dbContext.Set<ProcessedEventEntry>().RemoveRange(entries);
        await dbContext.SaveChangesAsync(ct);
    }
}
