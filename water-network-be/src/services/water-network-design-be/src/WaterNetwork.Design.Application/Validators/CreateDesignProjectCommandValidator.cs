using FluentValidation;
using WaterNetwork.Design.Application.Commands;

namespace WaterNetwork.Design.Application.Validators;

public sealed class CreateDesignProjectCommandValidator : AbstractValidator<CreateDesignProjectCommand>
{
    public CreateDesignProjectCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(200);
        RuleFor(x => x.BranchId).MaximumLength(64);
        RuleFor(x => x.ZoneId).MaximumLength(64);
    }
}
