using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class StartIncidentHandlingRequestValidator : AbstractValidator<StartIncidentHandlingRequest>
{
    public StartIncidentHandlingRequestValidator()
    {
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
