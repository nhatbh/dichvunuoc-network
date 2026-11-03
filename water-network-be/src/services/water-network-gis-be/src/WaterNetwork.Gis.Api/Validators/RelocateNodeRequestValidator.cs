using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class RelocateNodeRequestValidator : AbstractValidator<RelocateNodeRequest>
{
    public RelocateNodeRequestValidator()
    {
        RuleFor(x => x.Latitude)
            .InclusiveBetween(-90, 90).WithMessage("Latitude must be between -90 and 90.");
        RuleFor(x => x.Longitude)
            .InclusiveBetween(-180, 180).WithMessage("Longitude must be between -180 and 180.");
    }
}
