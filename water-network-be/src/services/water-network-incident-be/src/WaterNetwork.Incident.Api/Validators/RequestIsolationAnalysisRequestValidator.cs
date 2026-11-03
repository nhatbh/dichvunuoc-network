using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class RequestIsolationAnalysisRequestValidator : AbstractValidator<RequestIsolationAnalysisRequest>
{
    public RequestIsolationAnalysisRequestValidator()
    {
        RuleFor(x => x.StartNodeId).NotEmpty().WithMessage("startNodeId is required.");
    }
}
