using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class CancelIncidentCommandValidator : AbstractValidator<CancelIncidentCommand>
{
    public CancelIncidentCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(1000);
    }
}
