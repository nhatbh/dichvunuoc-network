using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class ClassifyIncidentCommandValidator : AbstractValidator<ClassifyIncidentCommand>
{
    public ClassifyIncidentCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Category).IsInEnum();
        RuleFor(x => x.Severity).InclusiveBetween(1, 4);
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
