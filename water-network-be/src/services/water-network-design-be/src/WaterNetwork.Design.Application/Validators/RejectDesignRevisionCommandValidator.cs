using FluentValidation;
using WaterNetwork.Design.Application.Commands;

namespace WaterNetwork.Design.Application.Validators;

public sealed class RejectDesignRevisionCommandValidator : AbstractValidator<RejectDesignRevisionCommand>
{
    public RejectDesignRevisionCommandValidator()
    {
        RuleFor(x => x.RevisionId).NotEmpty();
        RuleFor(x => x.Reason).NotEmpty().WithMessage("A reason is required when rejecting a revision.");
    }
}
