using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class ConfirmIsolationPlanRequestValidator : AbstractValidator<ConfirmIsolationPlanRequest>
{
    public ConfirmIsolationPlanRequestValidator()
    {
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
