using FluentAssertions;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Validators;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RegisterPipeCommandValidatorTests
{
    private readonly RegisterPipeCommandValidator _validator = new();

    private static (double Lat, double Lng)[] TwoPoints()
        => [(10.0, 106.0), (10.1, 106.1)];

    [Fact]
    public void Valid_Command_Passes()
    {
        var cmd = new RegisterPipeCommand(
            AssetCode: "PP-001",
            FromNodeId: "node-aaa",
            ToNodeId: "node-bbb",
            Points: TwoPoints(),
            DiameterMm: 150,
            Material: "HDPE",
            LengthM: null);

        _validator.Validate(cmd).IsValid.Should().BeTrue();
    }

    [Fact]
    public void AssetCode_Empty_Fails()
    {
        var cmd = new RegisterPipeCommand("", "node-aaa", "node-bbb", TwoPoints(), 150, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.AssetCode));
    }

    [Fact]
    public void AssetCode_Over64Chars_Fails()
    {
        var longCode = new string('A', 65);
        var cmd = new RegisterPipeCommand(longCode, "node-aaa", "node-bbb", TwoPoints(), 150, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.AssetCode));
    }

    [Fact]
    public void AssetCode_InvalidCharacters_Fails()
    {
        // Characters like spaces or special symbols are not allowed (only A-Za-z0-9_-).
        var cmd = new RegisterPipeCommand("PP 001!", "node-aaa", "node-bbb", TwoPoints(), 150, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.AssetCode));
    }

    [Fact]
    public void Points_LessThan2_Fails()
    {
        var onePoint = new[] { (10.0, 106.0) };
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", onePoint, 150, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.Points)
            && e.ErrorMessage.Contains("at least 2"));
    }

    [Fact]
    public void Point_LatOutOfRange_Fails()
    {
        var badPoints = new[] { (91.0, 106.0), (10.1, 106.1) };
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", badPoints, 150, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.ErrorMessage.Contains("latitude", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Point_LngOutOfRange_Fails()
    {
        var badPoints = new[] { (10.0, 181.0), (10.1, 106.1) };
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", badPoints, 150, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.ErrorMessage.Contains("longitude", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void DiameterMm_Zero_Fails()
    {
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", TwoPoints(), 0, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.DiameterMm)
            && e.ErrorMessage.Contains("greater than"));
    }

    [Fact]
    public void DiameterMm_Negative_Fails()
    {
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", TwoPoints(), -1, "HDPE", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.DiameterMm));
    }

    [Fact]
    public void Material_Empty_Fails()
    {
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", TwoPoints(), 150, "", null);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.Material));
    }

    [Fact]
    public void LengthM_Negative_Fails()
    {
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", TwoPoints(), 150, "HDPE", -1.0);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.LengthM)
            && e.ErrorMessage.Contains("greater than"));
    }

    [Fact]
    public void LengthM_Null_IsValid()
    {
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", TwoPoints(), 150, "HDPE", null);
        _validator.Validate(cmd).IsValid.Should().BeTrue();
    }

    [Fact]
    public void LengthM_Zero_Fails()
    {
        // LengthM = 0 fails because GreaterThan(0) excludes zero (boundary is not valid).
        var cmd = new RegisterPipeCommand("PP-001", "node-aaa", "node-bbb", TwoPoints(), 150, "HDPE", 0.0);
        var result = _validator.Validate(cmd);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(cmd.LengthM));
    }
}
