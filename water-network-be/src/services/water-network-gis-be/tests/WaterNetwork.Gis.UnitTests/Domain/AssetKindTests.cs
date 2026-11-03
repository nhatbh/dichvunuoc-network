using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class AssetKindTests
{
    [Theory]
    [InlineData("Node",   "Node")]
    [InlineData("node",   "Node")]
    [InlineData("NODE",   "Node")]
    [InlineData("Pipe",   "Pipe")]
    [InlineData("pipe",   "Pipe")]
    [InlineData("PIPE",   "Pipe")]
    [InlineData("Device", "Device")]
    [InlineData("device", "Device")]
    [InlineData("DEVICE", "Device")]
    public void Parses_Valid_Catalog_Values_Case_Insensitive(string input, string expectedCanonical)
    {
        var kind = AssetKind.Parse(input);
        kind.ToString().Should().Be(expectedCanonical);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("sensor")]
    [InlineData("Valve")]
    [InlineData("unknown")]
    public void Rejects_Unknown_Values(string? input)
    {
        // null is intentionally passed to document that Parse null-guards at runtime
#pragma warning disable CS8604 // Possible null reference argument
        var act = () => AssetKind.Parse(input!);
#pragma warning restore CS8604
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("AssetKind.Invalid");
    }

    [Fact]
    public void Equality_Same_Canonical()
    {
        AssetKind.Parse("Node").Should().Be(AssetKind.Parse("node"));
    }

    [Fact]
    public void Not_Equal_Different_Kinds()
    {
        AssetKind.Parse("Node").Should().NotBe(AssetKind.Parse("Pipe"));
    }
}
