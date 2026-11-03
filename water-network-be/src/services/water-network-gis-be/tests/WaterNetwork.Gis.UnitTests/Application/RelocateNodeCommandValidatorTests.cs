using FluentAssertions;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Validators;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RelocateNodeCommandValidatorTests
{
    private readonly RelocateNodeCommandValidator _validator = new();

    private static RelocateNodeCommand Valid() => new(
        NodeId: "node-abc123",
        Latitude: 10.762622,
        Longitude: 106.660172,
        Reason: null);

    [Fact]
    public void Valid_Command_Passes()
        => _validator.Validate(Valid()).IsValid.Should().BeTrue();

    [Fact]
    public void Empty_NodeId_Fails()
        => _validator.Validate(Valid() with { NodeId = "" }).IsValid.Should().BeFalse();

    [Theory]
    [InlineData(-91)]
    [InlineData(91)]
    public void Latitude_Out_Of_Range_Fails(double lat)
        => _validator.Validate(Valid() with { Latitude = lat }).IsValid.Should().BeFalse();

    [Theory]
    [InlineData(-181)]
    [InlineData(181)]
    public void Longitude_Out_Of_Range_Fails(double lng)
        => _validator.Validate(Valid() with { Longitude = lng }).IsValid.Should().BeFalse();

    [Theory]
    [InlineData(-90)]
    [InlineData(90)]
    public void Latitude_At_Boundary_Passes(double lat)
        => _validator.Validate(Valid() with { Latitude = lat }).IsValid.Should().BeTrue();

    [Theory]
    [InlineData(-180)]
    [InlineData(180)]
    public void Longitude_At_Boundary_Passes(double lng)
        => _validator.Validate(Valid() with { Longitude = lng }).IsValid.Should().BeTrue();

    [Fact]
    public void Null_Reason_Is_Valid()
        => _validator.Validate(Valid() with { Reason = null }).IsValid.Should().BeTrue();

    [Fact]
    public void With_Reason_Is_Valid()
        => _validator.Validate(Valid() with { Reason = "survey fix" }).IsValid.Should().BeTrue();
}
