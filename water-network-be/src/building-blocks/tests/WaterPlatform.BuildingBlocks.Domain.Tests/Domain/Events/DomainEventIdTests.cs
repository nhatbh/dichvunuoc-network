using FluentAssertions;
using WaterPlatform.BuildingBlocks.Domain.Events;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Domain.Tests.Domain.Events;

public class DomainEventIdTests
{
    private sealed record TestEvent : BaseDomainEvent
    {
        public override string EventType => "TestEvent";
        public override string AggregateId => "agg-1";
        public override string AggregateType => "TestAggregate";
    }

    private sealed record TestDataEvent() : DomainEventBase<string>(
        aggregateId: "agg-1",
        aggregateType: "TestAggregate",
        eventType: "TestDataEvent",
        data: "payload");

    [Fact]
    public void BaseDomainEvent_EventId_Is_UuidV7()
    {
        var evt = new TestEvent();

        Guid.Parse(evt.EventId).Version.Should().Be(7);
    }

    [Fact]
    public void DomainEventBase_EventId_Is_UuidV7()
    {
        var evt = new TestDataEvent();

        Guid.Parse(evt.EventId).Version.Should().Be(7);
    }

    [Fact]
    public void EventIds_Are_TimeOrdered()
    {
        var first = new TestEvent();
        Thread.Sleep(2);
        var second = new TestEvent();

        string.CompareOrdinal(first.EventId, second.EventId).Should().BeNegative(
            "uuid v7 event ids generated later must sort after earlier ones");
    }
}
