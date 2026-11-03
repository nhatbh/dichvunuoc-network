namespace WaterPlatform.BuildingBlocks.EventBus.Integration;

/// <summary>
/// The single CLR type used as the MassTransit message contract for all integration events.
/// </summary>
/// <remarks>
/// Because all integration events are published as this single CLR type, MassTransit creates
/// one exchange for the entire platform. Consumers receive every event type and must filter
/// by <see cref="EventType"/> to handle only the events they care about. Per-event-type
/// exchange routing (one exchange per logical event) is a known follow-up improvement.
/// </remarks>
public sealed record IntegrationEventEnvelope(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string? TenantId,
    string? OrganizationId,
    string? BranchId,
    string? CorrelationId,
    string? CausationId,
    string Producer,
    string Payload);
