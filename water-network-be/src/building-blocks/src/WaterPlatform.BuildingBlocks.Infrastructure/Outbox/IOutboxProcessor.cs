namespace WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

public interface IOutboxProcessor
{
    Task ProcessOutboxAsync(CancellationToken ct = default);
    Task StartAsync(CancellationToken ct = default);
    Task StopAsync(CancellationToken ct = default);
}
