using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class ResolveIncidentRequestValidator : AbstractValidator<ResolveIncidentRequest>
{
    public ResolveIncidentRequestValidator()
    {
        RuleFor(x => x.ResolutionNote).MaximumLength(1000);
    }
}
