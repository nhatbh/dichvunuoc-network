namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public interface IProcessedEventStore
{
    Task<bool> HasBeenProcessedAsync(string projectionName, string eventId, CancellationToken ct = default);
    Task MarkAsProcessedAsync(string projectionName, string eventId, CancellationToken ct = default);
    Task CleanupAsync(string projectionName, DateTime olderThan, CancellationToken ct = default);
}
