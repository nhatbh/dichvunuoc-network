using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Components;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class RegisterNodeRequestValidator : AbstractValidator<RegisterNodeRequest>
{
    public RegisterNodeRequestValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.ComponentCode).NotEmpty()
            .Must(c => ComponentCatalog.Default.Find(c)?.Kind == ComponentKind.Node)
            .WithMessage("ComponentCode must be a catalog node component (a fitting or a facility).");
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90);
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180);
    }
}
