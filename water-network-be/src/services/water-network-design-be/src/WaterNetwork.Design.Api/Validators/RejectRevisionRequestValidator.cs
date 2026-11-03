using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class RejectRevisionRequestValidator : AbstractValidator<RejectRevisionRequest>
{
    public RejectRevisionRequestValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().WithMessage("A reason is required when rejecting a revision.");
    }
}
