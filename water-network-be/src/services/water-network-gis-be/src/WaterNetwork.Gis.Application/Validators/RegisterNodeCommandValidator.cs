using FluentValidation;
using WaterNetwork.Gis.Application.Commands;
using WaterPlatform.BuildingBlocks.Components;

namespace WaterNetwork.Gis.Application.Validators;

public sealed class RegisterNodeCommandValidator : AbstractValidator<RegisterNodeCommand>
{
    public RegisterNodeCommandValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.ComponentCode).NotEmpty()
            .Must(v => ComponentCatalog.Default.Find(v)?.Kind == ComponentKind.Node)
            .WithMessage("ComponentCode must be a catalog node component (a fitting or a facility).");
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90);
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180);
    }
}
