using FluentAssertions;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Validators;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RegisterNodeCommandValidatorTests
{
    private readonly RegisterNodeCommandValidator _validator = new();

    [Fact]
    public void Valid_Command_Passes()
    {
        var result = _validator.Validate(new RegisterNodeCommand("ND-001", "Junction", 10.76, 106.66));
        result.IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData("", "Junction", 10, 106)]
    [InlineData("ND-001", "NotAType", 10, 106)]
    [InlineData("ND-001", "Junction", 95, 106)]
    [InlineData("ND-001", "Junction", 10, 200)]
    [InlineData("ND-001", "5", 10, 106)]
    [InlineData("ND-001", "GateValve", 10, 106)] // a device, not a node
    [InlineData("ND-001", "Pipe", 10, 106)]
    public void Invalid_Command_Fails(string assetCode, string nodeType, double lat, double lng)
    {
        var result = _validator.Validate(new RegisterNodeCommand(assetCode, nodeType, lat, lng));
        result.IsValid.Should().BeFalse();
    }

    [Theory]
    [InlineData("ND-001", "junction", 10, 106)]       // lowercase accepted
    [InlineData("ND-001", "Tee", 10, 106)]            // any catalog fitting
    [InlineData("ND-001", "BoosterStation", 10, 106)] // facilities are nodes
    [InlineData("ND-001", "TANK", 10, 106)]           // uppercase accepted
    public void Valid_Node_Components_Pass(string assetCode, string nodeType, double lat, double lng)
    {
        var result = _validator.Validate(new RegisterNodeCommand(assetCode, nodeType, lat, lng));
        result.IsValid.Should().BeTrue();
    }
}
