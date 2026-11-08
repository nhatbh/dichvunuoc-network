using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class AssetPropertiesTests
{
    private static Dictionary<string, string> D(params (string K, string V)[] kv)
        => kv.ToDictionary(x => x.K, x => x.V);

    [Fact]
    public void Accepts_Declared_Properties()
    {
        var p = AssetProperties.For(ComponentCode.Parse("Reducer"), D(("dn", "200"), ("dn2", "150"), ("material", "HDPE")));
        p.Values.Should().HaveCount(3).And.Contain("dn2", "150");
    }

    [Fact]
    public void Rejects_Undeclared_Keys()
    {
        var act = () => AssetProperties.For(ComponentCode.Parse("Tee"), D(("setpoint", "3")));
        act.Should().Throw<DomainException>().Which.Code.Should().Be("AssetProperties.Invalid");
    }

    [Theory]
    [InlineData("state", "half")]
    [InlineData("dn", "abc")]
    [InlineData("year", "1700")]
    public void Rejects_Invalid_Values(string key, string value)
    {
        var act = () => AssetProperties.For(ComponentCode.Parse("GateValve"), D((key, value)));
        act.Should().Throw<DomainException>().Which.Code.Should().Be("AssetProperties.Invalid");
    }

    [Fact]
    public void Declared_Keeps_Only_Catalog_Keys()
        => AssetProperties.Declared(ComponentCode.Parse("Hydrant"), D(("dn", "100"), ("source", "cad"), ("componentCode", "Hydrant")))
            .Keys.Should().BeEquivalentTo(["dn"]);

    [Fact]
    public void Null_Is_Empty()
        => AssetProperties.For(ComponentCode.Junction, null).Values.Should().BeEmpty();

    [Fact]
    public void FromAttributes_Ignores_NonProperty_Attributes_And_Rejects_Foreign_Properties()
    {
        var valve = ComponentCode.Parse("GateValve");
        AssetProperties.FromAttributes(valve, D(("componentCode", "GateValve"), ("source", "cad"), ("state", "open")))
            .Values.Should().Equal(new Dictionary<string, string> { ["state"] = "open" });

        var act = () => AssetProperties.FromAttributes(valve, D(("setpoint", "30")));
        act.Should().Throw<DomainException>().WithMessage("*setpoint*");
    }

    [Fact]
    public void FromAttributes_Lets_A_Pipe_Keep_Its_Own_Columns()
        => AssetProperties.FromAttributes(ComponentCode.Pipe, D(("diameterMm", "150"), ("material", "HDPE"), ("year", "2020")))
            .Values.Keys.Should().BeEquivalentTo(["year"]);
}
