using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using MassTransit;

namespace WaterPlatform.BuildingBlocks.EventBus.Integration;

public abstract class IdempotentIntegrationEventConsumer<TIntegrationEvent>(IInboxMessageStore inboxMessageStore)
    : IConsumer<TIntegrationEvent>
    where TIntegrationEvent : class, IIntegrationEvent
{
    protected abstract string ConsumerName { get; }

    public async Task Consume(ConsumeContext<TIntegrationEvent> context)
    {
        var messageId = context.Message.EventId;
        if (await inboxMessageStore.HasBeenProcessedAsync(ConsumerName, messageId, context.CancellationToken))
        {
            return;
        }

        await ConsumeEventAsync(context.Message, context);
        await inboxMessageStore.MarkAsProcessedAsync(ConsumerName, messageId, context.CancellationToken);
    }

    protected abstract Task ConsumeEventAsync(
        TIntegrationEvent integrationEvent,
        ConsumeContext<TIntegrationEvent> context);
}
