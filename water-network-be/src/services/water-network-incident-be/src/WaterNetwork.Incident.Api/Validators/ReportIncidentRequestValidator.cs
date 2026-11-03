using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class ReportIncidentRequestValidator : AbstractValidator<ReportIncidentRequest>
{
    public ReportIncidentRequestValidator()
    {
        RuleFor(x => x.Category).IsInEnum();
        RuleFor(x => x.Severity).InclusiveBetween(1, 4);
        RuleFor(x => x).Must(x => x.Longitude.HasValue == x.Latitude.HasValue)
            .WithMessage("Longitude and latitude must be provided together.");
        When(x => x.Longitude.HasValue, () =>
        {
            RuleFor(x => x.Longitude!.Value).InclusiveBetween(-180, 180);
            RuleFor(x => x.Latitude!.Value).InclusiveBetween(-90, 90);
        });
        RuleForEach(x => x.AffectedRefs).ChildRules(r =>
        {
            r.RuleFor(a => a.AssetId).NotEmpty().MaximumLength(64);
            r.RuleFor(a => a.Kind).IsInEnum();
        });
    }
}
