using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class CreateDesignProjectRequestValidator : AbstractValidator<CreateDesignProjectRequest>
{
    public CreateDesignProjectRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(200);
        RuleFor(x => x.BranchId).MaximumLength(64);
        RuleFor(x => x.ZoneId).MaximumLength(64);
    }
}
