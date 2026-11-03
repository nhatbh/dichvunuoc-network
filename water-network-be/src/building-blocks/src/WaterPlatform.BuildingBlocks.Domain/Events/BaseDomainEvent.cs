namespace WaterPlatform.BuildingBlocks.Domain.Events;

public abstract record BaseDomainEvent : IDomainEvent
{
    public string EventId { get; init; } = Guid.CreateVersion7().ToString();
    public DateTime OccurredAt { get; init; } = DateTime.UtcNow;
    public int EventVersion { get; init; } = 1;
    public abstract string EventType { get; }
    public abstract string AggregateId { get; }
    public abstract string AggregateType { get; }
    public IEventMetadata? Metadata { get; init; }
}
