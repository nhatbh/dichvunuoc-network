namespace WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

public sealed class OutboxOptions
{
    public const string SectionName = "Outbox";

    public int PollingIntervalSeconds { get; init; } = 5;
    public int BatchSize { get; init; } = 50;
    public int MaxRetries { get; init; } = 3;
    public int RetentionDays { get; init; } = 7;
}
