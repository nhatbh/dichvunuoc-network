using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.EventBus.Integration.Contracts;

public abstract record IntegrationEventBase<TData>(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    TData Data
) : IIntegrationEvent<TData>;
