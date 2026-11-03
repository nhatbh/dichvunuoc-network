using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class DeviceTypeTests
{
    [Theory]
    [InlineData("Valve", "Valve")]
    [InlineData("valve", "Valve")]
    [InlineData("FLOWMETER", "FlowMeter")]
    [InlineData("pressuresensor", "PressureSensor")]
    [InlineData("Pump", "Pump")]
    [InlineData("hydrant", "Hydrant")]
    public void Parse_Recognises_Catalog_CaseInsensitive(string input, string canonical)
        => DeviceType.Parse(input).ToString().Should().Be(canonical);

    [Theory]
    [InlineData("Sensor")]
    [InlineData("")]
    [InlineData("   ")]
    public void Parse_Unknown_Value_Throws(string input)
    {
        var act = () => DeviceType.Parse(input);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceType.Invalid");
    }

    [Fact]
    public void Equality_Is_By_Canonical_Value()
        => DeviceType.Parse("valve").Should().Be(DeviceType.Parse("VALVE"));
}
