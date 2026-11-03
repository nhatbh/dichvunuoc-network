using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Events;
using FluentAssertions;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Domain.Tests.Domain.Entities;

public class AggregateRootTests
{
    private sealed class TestAggregateRoot : AggregateRoot
    {
        public TestAggregateRoot(string id, int version = 0) : base(id, version) { }
        public void TestMarkAsModified() => MarkAsModified();
        public void TestAddDomainEvent(IDomainEvent e) => AddDomainEvent(e);
    }

    private sealed record TestEvent(string AggregateId)
        : DomainEventBase<string>(AggregateId, "Test", "TestEvent", "test-data");

    [Fact]
    public void Should_Start_With_Zero_Version()
    {
        var ar = new TestAggregateRoot("test-1");
        ar.Version.Should().Be(0);
    }

    [Fact]
    public void Should_Start_With_Specified_Version()
    {
        var ar = new TestAggregateRoot("test-1", 5);
        ar.Version.Should().Be(5);
    }

    [Fact]
    public void Should_Increment_Version_On_Modification()
    {
        var ar = new TestAggregateRoot("test-1");
        ar.TestMarkAsModified();
        ar.Version.Should().Be(1);
        ar.TestMarkAsModified();
        ar.Version.Should().Be(2);
    }

    [Fact]
    public void Should_Collect_Domain_Events()
    {
        var ar = new TestAggregateRoot("test-1");
        var e1 = new TestEvent("test-1");
        var e2 = new TestEvent("test-1");
        ar.TestAddDomainEvent(e1);
        ar.TestAddDomainEvent(e2);
        ar.GetDomainEvents().Should().HaveCount(2);
        ar.GetDomainEvents()[0].Should().BeSameAs(e1);
        ar.GetDomainEvents()[1].Should().BeSameAs(e2);
    }

    [Fact]
    public void Should_Clear_Domain_Events()
    {
        var ar = new TestAggregateRoot("test-1");
        ar.TestAddDomainEvent(new TestEvent("test-1"));
        ar.ClearDomainEvents();
        ar.GetDomainEvents().Should().BeEmpty();
    }

    [Fact]
    public void Should_Update_UpdatedAt_On_Modification()
    {
        var ar = new TestAggregateRoot("test-1");
        var before = ar.UpdatedAt;
        Thread.Sleep(1);
        ar.TestMarkAsModified();
        ar.UpdatedAt.Should().BeOnOrAfter(before);
    }

    [Fact]
    public void Should_Compare_By_Id()
    {
        var a = new TestAggregateRoot("same-id");
        var b = new TestAggregateRoot("same-id");
        a.Equals(b).Should().BeTrue();
        (a == b).Should().BeTrue();
    }

    [Fact]
    public void Should_Not_Equal_Different_Id()
    {
        var a = new TestAggregateRoot("id-1");
        var b = new TestAggregateRoot("id-2");
        a.Equals(b).Should().BeFalse();
        (a != b).Should().BeTrue();
    }

    [Fact]
    public void Should_Not_Equal_Null()
    {
        var a = new TestAggregateRoot("id-1");
        a.Equals(null).Should().BeFalse();
    }

    [Fact]
    public void Should_Not_Equal_Different_Type()
    {
        var a = new TestAggregateRoot("id-1");
        a.Equals("not an aggregate").Should().BeFalse();
    }

    [Fact]
    public void Should_Have_Same_HashCode_For_Same_Id()
    {
        var a = new TestAggregateRoot("same-id");
        var b = new TestAggregateRoot("same-id");
        a.GetHashCode().Should().Be(b.GetHashCode());
    }

    [Fact]
    public void Should_Set_CreatedAt_And_UpdatedAt_On_Construction()
    {
        var before = DateTime.UtcNow;
        var ar = new TestAggregateRoot("test-1");
        var after = DateTime.UtcNow;
        ar.CreatedAt.Should().BeOnOrAfter(before);
        ar.CreatedAt.Should().BeOnOrBefore(after);
        ar.UpdatedAt.Should().Be(ar.CreatedAt);
    }

    [Fact]
    public void Should_Throw_For_Empty_Id()
    {
        var act = () => new TestAggregateRoot("");
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Should_Throw_For_Null_Id()
    {
        var act = () => new TestAggregateRoot(null!);
        act.Should().Throw<ArgumentException>();
    }
}
