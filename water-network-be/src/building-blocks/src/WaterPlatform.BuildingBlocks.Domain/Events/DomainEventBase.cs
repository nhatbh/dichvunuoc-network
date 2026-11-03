namespace WaterPlatform.BuildingBlocks.Domain.Events;

public abstract record DomainEventBase<TData> : IDomainEvent<TData>
{
    public string EventId { get; init; }
    public string EventType { get; init; }
    public int EventVersion { get; init; }
    public string AggregateId { get; init; }
    public string AggregateType { get; init; }
    public DateTime OccurredAt { get; init; }
    public TData Data { get; init; }
    public IEventMetadata? Metadata { get; init; }

    protected DomainEventBase(
        string aggregateId,
        string aggregateType,
        string eventType,
        TData data,
        IEventMetadata? metadata = null,
        int eventVersion = 1)
    {
        EventId = Guid.CreateVersion7().ToString();
        EventType = eventType;
        EventVersion = eventVersion;
        AggregateId = aggregateId;
        AggregateType = aggregateType;
        OccurredAt = DateTime.UtcNow;
        Data = data;
        Metadata = metadata;
    }
}
