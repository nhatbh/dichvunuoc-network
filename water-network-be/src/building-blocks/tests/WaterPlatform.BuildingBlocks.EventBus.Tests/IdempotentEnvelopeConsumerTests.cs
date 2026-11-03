using FluentAssertions;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using Xunit;

namespace WaterPlatform.BuildingBlocks.EventBus.Tests;

/// <summary>
/// Broker-free unit tests for the <see cref="IdempotentEnvelopeConsumer"/> base contract:
/// filter → dedup → handle → mark, and "throw before mark" leaving the message unmarked.
/// </summary>
public class IdempotentEnvelopeConsumerTests
{
    private static IntegrationEventEnvelope Envelope(string eventId, string eventType)
        => new(eventId, eventType, 1, DateTime.UtcNow, null, null, null, null, null, "p", "{}");

    [Fact]
    public async Task Unsubscribed_Event_Type_Is_Skipped_Without_Handling_Or_Marking()
    {
        var inbox = new FakeInbox();
        var consumer = new TestConsumer(inbox);

        await consumer.HandleEnvelopeAsync(Envelope("evt-1", "unsubscribed"), default);

        consumer.Handled.Should().BeEmpty();
        inbox.Marked.Should().BeEmpty();
    }

    [Fact]
    public async Task Already_Processed_Event_Is_Skipped_Without_Handling()
    {
        var inbox = new FakeInbox();
        inbox.Marked.Add(("test", "evt-1"));
        var consumer = new TestConsumer(inbox);

        await consumer.HandleEnvelopeAsync(Envelope("evt-1", "subscribed"), default);

        consumer.Handled.Should().BeEmpty();
    }

    [Fact]
    public async Task Subscribed_Event_Is_Handled_Then_Marked()
    {
        var inbox = new FakeInbox();
        var consumer = new TestConsumer(inbox);

        await consumer.HandleEnvelopeAsync(Envelope("evt-1", "subscribed"), default);

        consumer.Handled.Should().ContainSingle().Which.Should().Be("evt-1");
        inbox.Marked.Should().ContainSingle().Which.Should().Be(("test", "evt-1"));
    }

    [Fact]
    public async Task Handle_Throwing_Leaves_Message_Unmarked_For_Redelivery()
    {
        var inbox = new FakeInbox();
        var consumer = new TestConsumer(inbox) { ThrowOnHandle = true };

        var act = () => consumer.HandleEnvelopeAsync(Envelope("evt-1", "subscribed"), default);

        await act.Should().ThrowAsync<InvalidOperationException>();
        inbox.Marked.Should().BeEmpty();
    }

    private sealed class TestConsumer(IInboxMessageStore inbox) : IdempotentEnvelopeConsumer(inbox)
    {
        public List<string> Handled { get; } = [];
        public bool ThrowOnHandle { get; init; }

        protected override string ConsumerName => "test";
        protected override bool Subscribes(string eventType) => eventType == "subscribed";

        protected override Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
        {
            if (ThrowOnHandle)
                throw new InvalidOperationException("boom");
            Handled.Add(envelope.EventId);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeInbox : IInboxMessageStore
    {
        public HashSet<(string consumer, string messageId)> Marked { get; } = [];

        public Task<bool> HasBeenProcessedAsync(string consumerName, string messageId, CancellationToken ct = default)
            => Task.FromResult(Marked.Contains((consumerName, messageId)));

        public Task MarkAsProcessedAsync(string consumerName, string messageId, CancellationToken ct = default)
        {
            Marked.Add((consumerName, messageId));
            return Task.CompletedTask;
        }
    }
}
