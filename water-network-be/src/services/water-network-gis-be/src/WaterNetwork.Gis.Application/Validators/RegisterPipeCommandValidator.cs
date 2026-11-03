using FluentValidation;
using WaterNetwork.Gis.Application.Commands;

namespace WaterNetwork.Gis.Application.Validators;

public sealed class RegisterPipeCommandValidator : AbstractValidator<RegisterPipeCommand>
{
    public RegisterPipeCommandValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");

        RuleFor(x => x.Points)
            .Must(pts => pts != null && pts.Count >= 2)
            .WithMessage("Points must contain at least 2 coordinates.");

        RuleForEach(x => x.Points)
            .Must(p => p.Lat is >= -90 and <= 90)
            .WithMessage("Each point latitude must be between -90 and 90.")
            .OverridePropertyName("Points[].Latitude");

        RuleForEach(x => x.Points)
            .Must(p => p.Lng is >= -180 and <= 180)
            .WithMessage("Each point longitude must be between -180 and 180.")
            .OverridePropertyName("Points[].Longitude");

        RuleFor(x => x.DiameterMm)
            .GreaterThan(0).WithMessage("DiameterMm must be greater than 0.");

        RuleFor(x => x.Material).NotEmpty();

        RuleFor(x => x.LengthM)
            .GreaterThan(0).WithMessage("LengthM must be greater than 0 when provided.")
            .When(x => x.LengthM.HasValue);
    }
}
