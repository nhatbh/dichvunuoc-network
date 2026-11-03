using System.Text.Json;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration.Contracts;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.EventBus.Integration;

/// <summary>
/// A catch-all <see cref="IIntegrationEventMapper"/> that wraps any <see cref="IDomainEvent"/>
/// into a <see cref="SerializedDomainEventIntegrationEvent"/> carrying the JSON-serialized payload.
/// Specific bounded-contexts should register their own mappers with narrower <c>CanMap</c> predicates
/// so they take priority over this fallback.
/// </summary>
internal sealed class SerializedDomainEventIntegrationEventMapper : IIntegrationEventMapper
{
    public bool CanMap(string eventType) => !string.IsNullOrWhiteSpace(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
    {
        var payload = domainEvent is ISerializedDomainEvent serialized
            ? serialized.Payload
            : JsonSerializer.Serialize(domainEvent);

        return new SerializedDomainEventIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: domainEvent.EventType,
            EventVersion: domainEvent.EventVersion,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: payload);
    }
}
