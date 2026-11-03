using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

internal sealed class OutboxRepository(PlatformDbContext dbContext, ITenantContextAccessor tenantAccessor) : IOutboxRepository
{
    public async Task AddAsync(IDomainEvent domainEvent, CancellationToken ct = default)
    {
        var entry = new OutboxEntry
        {
            AggregateId = domainEvent.AggregateId,
            AggregateType = domainEvent.AggregateType,
            EventType = domainEvent.EventType,
            EventVersion = domainEvent.EventVersion,
            TenantId = tenantAccessor.Current?.TenantId,
            // Cast to object so STJ uses the runtime type, preserving the concrete event's
            // Data property (and any other fields not in IDomainEvent) in the payload.
            // Without this cast, STJ infers T=IDomainEvent and omits Data from the serialized JSON.
            Payload = JsonSerializer.Serialize((object)domainEvent),
            Status = OutboxEntryStatus.Pending,
            CreatedAt = domainEvent.OccurredAt
        };

        await dbContext.OutboxEntries.AddAsync(entry, ct);
    }

    public async Task AddManyAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct = default)
    {
        var entries = events.Select(domainEvent => new OutboxEntry
        {
            AggregateId = domainEvent.AggregateId,
            AggregateType = domainEvent.AggregateType,
            EventType = domainEvent.EventType,
            EventVersion = domainEvent.EventVersion,
            TenantId = tenantAccessor.Current?.TenantId,
            // Cast to object so STJ uses the runtime type (see AddAsync comment).
            Payload = JsonSerializer.Serialize((object)domainEvent),
            Status = OutboxEntryStatus.Pending,
            CreatedAt = domainEvent.OccurredAt
        }).ToList();

        await dbContext.OutboxEntries.AddRangeAsync(entries, ct);
    }

    public async Task<IReadOnlyList<OutboxEntry>> GetPendingAsync(int limit, CancellationToken ct = default)
    {
        return await dbContext.OutboxEntries
            .Where(e => e.Status == OutboxEntryStatus.Pending)
            .OrderBy(e => e.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);
    }

    public async Task<bool> MarkAsProcessingAsync(string id, CancellationToken ct = default)
    {
        var entry = await dbContext.OutboxEntries.FindAsync([id], ct);
        if (entry is null)
        {
            return false;
        }

        entry.Status = OutboxEntryStatus.Processing;
        entry.RetryCount++;
        dbContext.OutboxEntries.Update(entry);
        await dbContext.SaveChangesAsync(ct);
        return true;
    }

    public async Task MarkAsProcessedAsync(string id, CancellationToken ct = default)
    {
        var entry = await dbContext.OutboxEntries.FindAsync([id], ct);
        if (entry is null)
        {
            return;
        }

        entry.Status = OutboxEntryStatus.Processed;
        entry.ProcessedAt = DateTime.UtcNow;
        dbContext.OutboxEntries.Update(entry);
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task MarkAsFailedAsync(string id, string errorMessage, CancellationToken ct = default)
    {
        var entry = await dbContext.OutboxEntries.FindAsync([id], ct);
        if (entry is null)
        {
            return;
        }

        entry.Status = OutboxEntryStatus.Failed;
        entry.LastError = errorMessage;
        dbContext.OutboxEntries.Update(entry);
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task<int> DeleteProcessedAsync(DateTime olderThan, CancellationToken ct = default)
    {
        var entries = await dbContext.OutboxEntries
            .Where(e => e.Status == OutboxEntryStatus.Processed && e.ProcessedAt < olderThan)
            .ToListAsync(ct);

        dbContext.OutboxEntries.RemoveRange(entries);
        await dbContext.SaveChangesAsync(ct);
        return entries.Count;
    }

    public async Task<int> ResetForRetryAsync(int maxRetries, CancellationToken ct = default)
    {
        var entries = await dbContext.OutboxEntries
            .Where(e => e.Status == OutboxEntryStatus.Failed && e.RetryCount < maxRetries)
            .ToListAsync(ct);

        foreach (var entry in entries)
        {
            entry.Status = OutboxEntryStatus.Pending;
        }

        dbContext.OutboxEntries.UpdateRange(entries);
        await dbContext.SaveChangesAsync(ct);
        return entries.Count;
    }
}
