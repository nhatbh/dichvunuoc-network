using MassTransit;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.EventBus.Integration;

/// <summary>
/// Base for consumers of the platform <see cref="IntegrationEventEnvelope"/>. Filters by
/// <see cref="IntegrationEventEnvelope.EventType"/>, deduplicates via the inboxMessageStore, and exposes a
/// broker-free core (<see cref="HandleAsync"/>) so behaviour is integration-testable without MassTransit.
/// </summary>
/// <remarks>
/// If <see cref="HandleAsync"/> throws, the message is NOT marked processed — a redelivery retries.
/// </remarks>
public abstract class IdempotentEnvelopeConsumer(IInboxMessageStore inboxMessageStore)
    : IConsumer<IntegrationEventEnvelope>
{
    protected abstract string ConsumerName { get; }

    /// <summary>True for the EventTypes this consumer handles; others are ignored.</summary>
    protected abstract bool Subscribes(string eventType);

    public Task Consume(ConsumeContext<IntegrationEventEnvelope> context)
        => HandleEnvelopeAsync(context.Message, context.CancellationToken);

    /// <summary>Broker-free core: filter → inboxMessageStore dedup → handle → mark processed.</summary>
    public async Task HandleEnvelopeAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        if (!Subscribes(envelope.EventType)) return;
        if (await inboxMessageStore.HasBeenProcessedAsync(ConsumerName, envelope.EventId, ct)) return;

        await HandleAsync(envelope, ct);

        await inboxMessageStore.MarkAsProcessedAsync(ConsumerName, envelope.EventId, ct);
    }

    protected abstract Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct);
}
