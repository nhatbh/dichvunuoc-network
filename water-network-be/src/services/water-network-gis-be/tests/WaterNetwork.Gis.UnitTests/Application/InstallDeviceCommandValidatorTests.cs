using FluentAssertions;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Validators;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class InstallDeviceCommandValidatorTests
{
    private readonly InstallDeviceCommandValidator _validator = new();

    private static InstallDeviceCommand Valid() => new(
        AssetCode: "DV-001",
        DeviceType: "Valve",
        HostPipeId: "pipe-1",
        HostNodeId: null,
        Latitude: 10.762622,
        Longitude: 106.660172);

    [Fact]
    public void Valid_Command_Passes()
        => _validator.Validate(Valid()).IsValid.Should().BeTrue();

    [Theory]
    [InlineData("")]
    [InlineData("has space")]
    public void Invalid_AssetCode_Fails(string code)
        => _validator.Validate(Valid() with { AssetCode = code }).IsValid.Should().BeFalse();

    [Fact]
    public void AssetCode_Over_64_Chars_Fails()
        => _validator.Validate(Valid() with { AssetCode = new string('a', 65) }).IsValid.Should().BeFalse();

    [Fact]
    public void Empty_DeviceType_Fails()
        => _validator.Validate(Valid() with { DeviceType = "" }).IsValid.Should().BeFalse();

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

    // Host shape is NOT validated here — it belongs to the DeviceHost VO (spec decision).
    [Fact]
    public void Host_Shape_Is_Not_Validated_Here()
        => _validator.Validate(Valid() with { HostPipeId = null, HostNodeId = null })
            .IsValid.Should().BeTrue();
}
