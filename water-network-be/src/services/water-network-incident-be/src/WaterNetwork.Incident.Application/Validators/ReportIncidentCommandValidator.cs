using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class ReportIncidentCommandValidator : AbstractValidator<ReportIncidentCommand>
{
    public ReportIncidentCommandValidator()
    {
        RuleFor(x => x.Category).IsInEnum();
        RuleFor(x => x.Severity).InclusiveBetween(1, 4);
        RuleForEach(x => x.AffectedRefs).ChildRules(r =>
        {
            r.RuleFor(a => a.AssetId).NotEmpty().MaximumLength(64);
            r.RuleFor(a => a.Kind).IsInEnum();
        });
        RuleFor(x => x).Must(x => x.Longitude.HasValue == x.Latitude.HasValue)
            .WithMessage("Longitude and latitude must be provided together.");
        When(x => x.Longitude.HasValue, () =>
        {
            RuleFor(x => x.Longitude!.Value).InclusiveBetween(-180, 180);
            RuleFor(x => x.Latitude!.Value).InclusiveBetween(-90, 90);
        });
    }
}
