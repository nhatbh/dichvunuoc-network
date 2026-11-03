using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class InstallDeviceRequestValidator : AbstractValidator<InstallDeviceRequest>
{
    public InstallDeviceRequestValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");

        // Delegate device-type validation to the Domain VO to avoid duplicating the catalog.
        RuleFor(x => x.DeviceType)
            .NotEmpty()
            .Must(t =>
            {
                try { DeviceType.Parse(t); return true; }
                catch (DomainException) { return false; }
            })
            .WithMessage("DeviceType must be one of: Valve, FlowMeter, PressureSensor, Pump, Hydrant.");

        RuleFor(x => x.HostPipeId).MaximumLength(64);
        RuleFor(x => x.HostNodeId).MaximumLength(64);

        RuleFor(x => x.Latitude)
            .InclusiveBetween(-90, 90).WithMessage("Latitude must be between -90 and 90.");
        RuleFor(x => x.Longitude)
            .InclusiveBetween(-180, 180).WithMessage("Longitude must be between -180 and 180.");

        // Host shape rules (per-deviceType matrix) are DOMAIN rules → DeviceHost VO → 400 DOMAIN_RULE.
    }
}
