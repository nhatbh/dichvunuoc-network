using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class ClassifyIncidentRequestValidator : AbstractValidator<ClassifyIncidentRequest>
{
    public ClassifyIncidentRequestValidator()
    {
        RuleFor(x => x.Category).IsInEnum();
        RuleFor(x => x.Severity).InclusiveBetween(1, 4);
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
