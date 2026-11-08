using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Components;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class InstallDeviceRequestValidator : AbstractValidator<InstallDeviceRequest>
{
    public InstallDeviceRequestValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");

        // The component catalog (decision 0028) decides which codes are devices.
        RuleFor(x => x.ComponentCode)
            .NotEmpty()
            .Must(c => ComponentCatalog.Default.Find(c)?.Kind == ComponentKind.Device)
            .WithMessage("ComponentCode must be a catalog device component (a valve, meter, pump, hydrant, sensor, ...).");

        RuleFor(x => x.HostPipeId).MaximumLength(64);
        RuleFor(x => x.HostNodeId).MaximumLength(64);

        RuleFor(x => x.Latitude)
            .InclusiveBetween(-90, 90).WithMessage("Latitude must be between -90 and 90.");
        RuleFor(x => x.Longitude)
            .InclusiveBetween(-180, 180).WithMessage("Longitude must be between -180 and 180.");

        // Host shape rules (the catalog host of the component) are DOMAIN rules → DeviceHost VO → 400 DOMAIN_RULE.
    }
}
