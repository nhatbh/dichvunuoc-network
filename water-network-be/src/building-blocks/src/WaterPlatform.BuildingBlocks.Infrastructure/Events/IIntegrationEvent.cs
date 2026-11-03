namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

public interface IIntegrationEvent
{
    string EventId { get; }
    string EventType { get; }
    int EventVersion { get; }
    DateTime OccurredAt { get; }
    string SourceAggregateId { get; }
    string SourceAggregateType { get; }
}

public interface IIntegrationEvent<out TData> : IIntegrationEvent
{
    TData Data { get; }
}
