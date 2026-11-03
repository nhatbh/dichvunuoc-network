namespace WaterPlatform.BuildingBlocks.EventBus.Integration.Contracts;

/// <summary>
/// A concrete integration event carrying a JSON-serialized domain event payload.
/// Used by <see cref="WaterPlatform.BuildingBlocks.EventBus.Integration.SerializedDomainEventIntegrationEventMapper"/>
/// as a fallback when no domain-specific mapper is registered.
/// </summary>
public sealed record SerializedDomainEventIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    string Data
) : IntegrationEventBase<string>(
    EventId,
    EventType,
    EventVersion,
    OccurredAt,
    SourceAggregateId,
    SourceAggregateType,
    Data);
