namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

public interface IInboxMessageStore
{
    Task<bool> HasBeenProcessedAsync(string consumerName, string messageId, CancellationToken ct = default);
    Task MarkAsProcessedAsync(string consumerName, string messageId, CancellationToken ct = default);
}
