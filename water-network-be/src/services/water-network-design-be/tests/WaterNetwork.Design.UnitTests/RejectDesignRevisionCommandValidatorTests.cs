using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Validators;

namespace WaterNetwork.Design.UnitTests;

public sealed class RejectDesignRevisionCommandValidatorTests
{
    private readonly RejectDesignRevisionCommandValidator _validator = new();

    [Fact]
    public void Empty_Reason_Is_Invalid()
    {
        var result = _validator.Validate(new RejectDesignRevisionCommand("rev-1", "  "));
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(RejectDesignRevisionCommand.Reason));
    }

    [Fact]
    public void Non_Empty_Reason_Is_Valid()
    {
        var result = _validator.Validate(new RejectDesignRevisionCommand("rev-1", "missing elevation"));
        result.IsValid.Should().BeTrue();
    }
}
