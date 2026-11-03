using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class ConfirmIsolationPlanCommandValidator : AbstractValidator<ConfirmIsolationPlanCommand>
{
    public ConfirmIsolationPlanCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
