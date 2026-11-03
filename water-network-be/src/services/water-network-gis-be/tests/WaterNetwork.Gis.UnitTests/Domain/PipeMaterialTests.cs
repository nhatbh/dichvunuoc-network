using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class PipeMaterialTests
{
    [Theory]
    [InlineData("HDPE", "HDPE")]
    [InlineData("hdpe", "HDPE")]
    [InlineData("Hdpe", "HDPE")]
    [InlineData("PVC", "PVC")]
    [InlineData("pvc", "PVC")]
    [InlineData("DuctileIron", "DuctileIron")]
    [InlineData("ductileiron", "DuctileIron")]
    [InlineData("DUCTILEIRON", "DuctileIron")]
    [InlineData("Steel", "Steel")]
    [InlineData("steel", "Steel")]
    [InlineData("STEEL", "Steel")]
    [InlineData("CastIron", "CastIron")]
    [InlineData("castiron", "CastIron")]
    [InlineData("CASTIRON", "CastIron")]
    [InlineData("Concrete", "Concrete")]
    [InlineData("concrete", "Concrete")]
    [InlineData("CONCRETE", "Concrete")]
    public void Parses_Valid_Catalog_Values_Case_Insensitive(string input, string expectedCanonical)
    {
        var m = PipeMaterial.Parse(input);
        m.ToString().Should().Be(expectedCanonical);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Iron")]
    [InlineData("Copper")]
    [InlineData("unknown")]
    public void Rejects_Unknown_Values(string input)
    {
        var act = () => PipeMaterial.Parse(input);
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("PipeMaterial.Invalid");
    }

    [Fact]
    public void Equality_Same_Canonical()
    {
        PipeMaterial.Parse("HDPE").Should().Be(PipeMaterial.Parse("hdpe"));
    }

    [Fact]
    public void Not_Equal_Different_Materials()
    {
        PipeMaterial.Parse("HDPE").Should().NotBe(PipeMaterial.Parse("PVC"));
    }
}
