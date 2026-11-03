// ValidationResultTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class ValidationResultTests
{
    [Fact]
    public void HasErrors_Is_True_When_Any_Error_Present()
    {
        var result = new ValidationResult(
            new[] { new ValidationIssue("DuplicateAssetCode", "d1", null, "assetCode", "dup") },
            Array.Empty<ValidationIssue>());
        result.HasErrors.Should().BeTrue();
    }

    [Fact]
    public void Empty_Result_Has_No_Errors()
    {
        var result = ValidationResult.Empty;
        result.HasErrors.Should().BeFalse();
        result.Errors.Should().BeEmpty();
        result.Warnings.Should().BeEmpty();
    }
}
