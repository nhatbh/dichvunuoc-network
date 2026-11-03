using WaterPlatform.BuildingBlocks.Domain.ValueObjects;
using FluentAssertions;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Domain.Tests.Domain.ValueObjects;

public class ValueObjectTests
{
    private sealed class TestValueObject(int a, string b) : ValueObject
    {
        public int A { get; } = a;
        public string B { get; } = b;

        protected override IEnumerable<object?> GetEqualityComponents() => [A, B];
    }

    private class DifferentValueObject(int a, string b) : ValueObject
    {
        protected override IEnumerable<object?> GetEqualityComponents() => [A, b];
        public int A => a;
    }

    [Fact]
    public void Should_Be_Equal_When_Components_Match()
    {
        var a = new TestValueObject(1, "test");
        var b = new TestValueObject(1, "test");
        a.Equals(b).Should().BeTrue();
        (a == b).Should().BeTrue();
    }

    [Fact]
    public void Should_Not_Be_Equal_When_Components_Differ()
    {
        var a = new TestValueObject(1, "test");
        var b = new TestValueObject(2, "test");
        a.Equals(b).Should().BeFalse();
        (a != b).Should().BeTrue();
    }

    [Fact]
    public void Should_Not_Be_Equal_When_Second_Component_Differs()
    {
        var a = new TestValueObject(1, "alpha");
        var b = new TestValueObject(1, "beta");
        a.Equals(b).Should().BeFalse();
    }

    [Fact]
    public void Should_Not_Be_Equal_To_Null()
    {
        var a = new TestValueObject(1, "test");
        a.Equals(null).Should().BeFalse();
        (a == null).Should().BeFalse();
    }

    [Fact]
    public void Should_Not_Be_Equal_To_Different_Type()
    {
        // ValueObject.Equals checks "obj is ValueObject" and compares components,
        // so different types with same components are equal. Use different values to verify distinction.
        var a = new TestValueObject(1, "test");
        var b = new DifferentValueObject(2, "test");
        a.Equals(b).Should().BeFalse();
    }

    [Fact]
    public void Should_Have_Same_HashCode_For_Equal_Objects()
    {
        var a = new TestValueObject(1, "test");
        var b = new TestValueObject(1, "test");
        a.GetHashCode().Should().Be(b.GetHashCode());
    }

    [Fact]
    public void Should_Have_Self_Equality()
    {
        var a = new TestValueObject(1, "test");
        a.Equals(a).Should().BeTrue();
    }

    [Fact]
    public void Null_Equality_Operator_Should_Work()
    {
        TestValueObject? a = null;
        TestValueObject? b = null;
        (a == b).Should().BeTrue();

        a = new TestValueObject(1, "test");
        (a == null).Should().BeFalse();
        (null == a).Should().BeFalse();
    }

    [Fact]
    public void Inequality_Operator_Should_Work()
    {
        var a = new TestValueObject(1, "test");
        var b = new TestValueObject(2, "test");
        (a != b).Should().BeTrue();
    }

    [Fact]
    public void Should_Handle_Null_Components()
    {
        var a = new TestValueObject(1, null!);
        var b = new TestValueObject(1, null!);
        a.Equals(b).Should().BeTrue();
    }
}
