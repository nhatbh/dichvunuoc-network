namespace WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

public sealed class OutboxEntry
{
    public string Id { get; init; } = Guid.CreateVersion7().ToString();
    public string AggregateId { get; init; } = default!;
    public string AggregateType { get; init; } = default!;
    public string EventType { get; init; } = default!;
    public int EventVersion { get; init; } = 1;
    public string? TenantId { get; init; }
    public string Payload { get; init; } = default!;
    public OutboxEntryStatus Status { get; set; } = OutboxEntryStatus.Pending;
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime? ProcessedAt { get; set; }
    public int RetryCount { get; set; }
    public string? LastError { get; set; }
}
