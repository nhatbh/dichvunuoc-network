using FluentValidation;
using WaterNetwork.Gis.Application.Commands;
using WaterPlatform.BuildingBlocks.Components;

namespace WaterNetwork.Gis.Application.Validators;

public sealed class InstallDeviceCommandValidator : AbstractValidator<InstallDeviceCommand>
{
    public InstallDeviceCommandValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.ComponentCode).NotEmpty()
            .Must(v => ComponentCatalog.Default.Find(v)?.Kind == ComponentKind.Device)
            .WithMessage("ComponentCode must be a catalog device component.");

        RuleFor(x => x.Latitude)
            .InclusiveBetween(-90, 90).WithMessage("Latitude must be between -90 and 90.");
        RuleFor(x => x.Longitude)
            .InclusiveBetween(-180, 180).WithMessage("Longitude must be between -180 and 180.");

        // Host shape rules (the catalog host of the component) live in the DeviceHost VO — not duplicated here.
    }
}
