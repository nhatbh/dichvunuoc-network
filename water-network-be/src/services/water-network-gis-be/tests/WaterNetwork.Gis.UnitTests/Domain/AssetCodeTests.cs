using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class AssetCodeTests
{
    [Theory]
    [InlineData("ND-001")]
    [InlineData("node_01")]
    public void Accepts_Valid_Code(string code)
    {
        new AssetCode(code).Value.Should().Be(code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("có dấu cách")]
    public void Rejects_Invalid_Code(string code)
    {
        var act = () => new AssetCode(code);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Rejects_Code_Longer_Than_64()
    {
        var act = () => new AssetCode(new string('a', 65));
        act.Should().Throw<DomainException>();
    }
}
