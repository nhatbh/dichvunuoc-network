using WaterPlatform.BuildingBlocks.Domain.Specifications;
using FluentAssertions;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Domain.Tests.Domain.Specifications;

public class SpecificationTests
{
    private class AlwaysTrueSpecification : Specification<string>
    {
        public override bool IsSatisfiedBy(string entity) => true;
    }

    private sealed class AlwaysFalseSpecification : Specification<string>
    {
        public override bool IsSatisfiedBy(string entity) => false;
    }

    private sealed class ContainsSpecification(string substring) : Specification<string>
    {
        public override bool IsSatisfiedBy(string entity) => entity.Contains(substring, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class StartsWithSpecification(string prefix) : Specification<string>
    {
        public override bool IsSatisfiedBy(string entity) => entity.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AlwaysTrue_Should_Satisfy_Any_Input()
    {
        var spec = new AlwaysTrueSpecification();
        spec.IsSatisfiedBy("anything").Should().BeTrue();
    }

    [Fact]
    public void AlwaysFalse_Should_Not_Satisfy_Any_Input()
    {
        var spec = new AlwaysFalseSpecification();
        spec.IsSatisfiedBy("anything").Should().BeFalse();
    }

    [Fact]
    public void And_Should_Be_True_When_Both_Are_True()
    {
        var spec = new ContainsSpecification("hello").And(new StartsWithSpecification("hello"));
        spec.IsSatisfiedBy("hello world").Should().BeTrue();
    }

    [Fact]
    public void And_Should_Be_False_When_One_Is_False()
    {
        var spec = new ContainsSpecification("hello").And(new StartsWithSpecification("world"));
        spec.IsSatisfiedBy("hello world").Should().BeFalse();
    }

    [Fact]
    public void Or_Should_Be_True_When_Any_Is_True()
    {
        var spec = new ContainsSpecification("hello").Or(new StartsWithSpecification("world"));
        spec.IsSatisfiedBy("world hello").Should().BeTrue();
    }

    [Fact]
    public void Or_Should_Be_False_When_Both_Are_False()
    {
        var spec = new ContainsSpecification("xyz").Or(new StartsWithSpecification("abc"));
        spec.IsSatisfiedBy("hello world").Should().BeFalse();
    }

    [Fact]
    public void Not_Should_Invert_True_To_False()
    {
        var spec = new AlwaysTrueSpecification().Not();
        spec.IsSatisfiedBy("anything").Should().BeFalse();
    }

    [Fact]
    public void Not_Should_Invert_False_To_True()
    {
        var spec = new AlwaysFalseSpecification().Not();
        spec.IsSatisfiedBy("anything").Should().BeTrue();
    }

    [Fact]
    public void Composite_And_Or_Should_Work_Together()
    {
        var spec = new ContainsSpecification("hello")
            .And(new StartsWithSpecification("hello"))
            .Or(new AlwaysTrueSpecification());
        spec.IsSatisfiedBy("anything").Should().BeTrue();
    }

    [Fact]
    public void Double_Not_Should_Return_To_Original()
    {
        var spec = new AlwaysTrueSpecification().Not().Not();
        spec.IsSatisfiedBy("anything").Should().BeTrue();
    }

    [Fact]
    public void And_Should_Short_Circuit_On_False()
    {
        var spec = new AlwaysFalseSpecification().And(new AlwaysTrueSpecification());
        spec.IsSatisfiedBy("test").Should().BeFalse();
    }

    [Fact]
    public void Or_Should_Short_Circuit_On_True()
    {
        var spec = new AlwaysTrueSpecification().Or(new AlwaysFalseSpecification());
        spec.IsSatisfiedBy("test").Should().BeTrue();
    }
}
