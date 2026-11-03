using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class RequestIsolationAnalysisCommandValidator
    : AbstractValidator<RequestIsolationAnalysisCommand>
{
    public RequestIsolationAnalysisCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty();
        RuleFor(x => x.StartNodeId).NotEmpty().WithMessage("A start node id is required for isolation analysis.");
    }
}
