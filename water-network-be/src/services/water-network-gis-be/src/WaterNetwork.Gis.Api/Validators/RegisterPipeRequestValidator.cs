using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class RegisterPipeRequestValidator : AbstractValidator<RegisterPipeRequest>
{
    public RegisterPipeRequestValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.FromNodeId).NotEmpty();
        RuleFor(x => x.ToNodeId).NotEmpty();

        RuleFor(x => x.Points)
            .Must(pts => pts != null && pts.Count >= 2)
            .WithMessage("Points must contain at least 2 coordinates.");

        RuleForEach(x => x.Points)
            .Must(p => p.Lat is >= -90 and <= 90)
            .WithMessage("Each point latitude must be between -90 and 90.")
            .OverridePropertyName("Points[].Lat");

        RuleForEach(x => x.Points)
            .Must(p => p.Lng is >= -180 and <= 180)
            .WithMessage("Each point longitude must be between -180 and 180.")
            .OverridePropertyName("Points[].Lng");

        RuleFor(x => x.DiameterMm)
            .GreaterThan(0).WithMessage("DiameterMm must be greater than 0.");

        RuleFor(x => x.DiameterMm)
            .Must(d => d % 1 == 0).WithMessage("DiameterMm must be a whole number of millimeters.")
            .When(x => x.DiameterMm > 0);

        // Delegate material validation to the Domain VO to avoid duplicating the catalog.
        RuleFor(x => x.Material)
            .NotEmpty()
            .Must(m =>
            {
                try { PipeMaterial.Parse(m); return true; }
                catch (DomainException) { return false; }
            })
            .WithMessage("Material must be one of the recognised pipe materials (e.g. HDPE, PVC, DuctileIron, Steel, CastIron, Concrete).");

        RuleFor(x => x.LengthM)
            .GreaterThan(0).WithMessage("LengthM must be greater than 0 when provided.")
            .When(x => x.LengthM.HasValue);
    }
}
