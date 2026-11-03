namespace WaterPlatform.BuildingBlocks.Domain.Events;

public interface IDomainEvent
{
    string EventId { get; }
    string EventType { get; }
    int EventVersion { get; }
    string AggregateId { get; }
    string AggregateType { get; }
    DateTime OccurredAt { get; }
    IEventMetadata? Metadata { get; }
}

public interface IDomainEvent<TData> : IDomainEvent
{
    TData Data { get; }
}
