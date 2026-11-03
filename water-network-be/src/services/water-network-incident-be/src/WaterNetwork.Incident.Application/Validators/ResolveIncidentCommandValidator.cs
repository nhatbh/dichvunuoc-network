using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class ResolveIncidentCommandValidator : AbstractValidator<ResolveIncidentCommand>
{
    public ResolveIncidentCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.ResolutionNote).MaximumLength(1000);
    }
}
