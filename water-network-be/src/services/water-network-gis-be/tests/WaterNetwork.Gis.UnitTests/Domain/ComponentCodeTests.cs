using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Components;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class ComponentCodeTests
{
    [Theory]
    [InlineData("GateValve", "GateValve")]
    [InlineData("gatevalve", "GateValve")]
    [InlineData("TEE", "Tee")]
    [InlineData("hydrant", "Hydrant")]
    public void Parse_Recognises_Catalog_Codes_CaseInsensitive(string input, string canonical)
        => ComponentCode.Parse(input).Value.Should().Be(canonical);

    [Theory]
    [InlineData("Valve")]
    [InlineData("Sprinkler")]
    [InlineData("")]
    public void Parse_Unknown_Code_Throws(string input)
    {
        var act = () => ComponentCode.Parse(input);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("Component.Unknown");
    }

    [Fact]
    public void Parse_With_Wrong_Kind_Throws()
    {
        var act = () => ComponentCode.Parse("GateValve", ComponentKind.Node);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("Component.WrongKind");
    }

    [Theory]
    [InlineData("GateValve", true)]
    [InlineData("ButterflyValve", true)]
    [InlineData("CheckValve", false)]
    [InlineData("PRV", false)]
    public void Isolating_Is_A_Catalog_Flag(string code, bool isolates)
        => ComponentCode.Parse(code).Does(ComponentFunctions.Isolates).Should().Be(isolates);

    [Fact]
    public void Value_Equality_By_Code()
        => ComponentCode.Parse("tee").Should().Be(ComponentCode.Parse("Tee"));
}
