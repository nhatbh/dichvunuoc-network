using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public sealed class InboxMessageStore(PlatformDbContext dbContext) : IInboxMessageStore
{
    public async Task<bool> HasBeenProcessedAsync(string consumerName, string messageId, CancellationToken ct = default)
    {
        return await dbContext.Set<ProcessedEventEntry>()
            .AnyAsync(e => e.ProjectionName == consumerName && e.EventId == messageId, ct);
    }

    public async Task MarkAsProcessedAsync(string consumerName, string messageId, CancellationToken ct = default)
    {
        if (await HasBeenProcessedAsync(consumerName, messageId, ct))
        {
            return;
        }

        var entry = new ProcessedEventEntry
        {
            Id = $"inbox:{consumerName}:{messageId}",
            ProjectionName = consumerName,
            EventId = messageId,
            ProcessedAt = DateTime.UtcNow
        };

        dbContext.Set<ProcessedEventEntry>().Add(entry);
        try
        {
            await dbContext.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Unique index makes duplicate delivery harmless when consumers race.
            dbContext.Entry(entry).State = EntityState.Detached;
        }
    }
}
