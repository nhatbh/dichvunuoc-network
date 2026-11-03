using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class DiameterTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    public void Rejects_Zero_Or_Negative(double value)
    {
        var act = () => new Diameter(value);
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("Diameter.NotPositive");
    }

    [Theory]
    [InlineData(4001)]
    [InlineData(10000)]
    public void Rejects_Above_4000mm(double value)
    {
        var act = () => new Diameter(value);
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("Diameter.TooLarge");
    }

    [Theory]
    [InlineData(0.1)]
    [InlineData(100)]
    [InlineData(4000)]
    public void Accepts_Valid_Value(double value)
    {
        var d = new Diameter(value);
        d.Value.Should().Be(value);
    }

    [Fact]
    public void Equality_By_Value()
    {
        new Diameter(150).Should().Be(new Diameter(150));
    }

    [Fact]
    public void Not_Equal_When_Values_Differ()
    {
        new Diameter(100).Should().NotBe(new Diameter(200));
    }
}
