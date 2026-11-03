using FluentValidation;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.ValueObjects;

namespace WaterNetwork.Gis.Application.Validators;

public sealed class RegisterNodeCommandValidator : AbstractValidator<RegisterNodeCommand>
{
    public RegisterNodeCommandValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.NodeType).NotEmpty()
            .Must(v => Enum.TryParse<NodeType>(v, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed))
            .WithMessage("NodeType must be one of: Junction, Reservoir, Tank, Hydrant, Other (case-insensitive).");
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90);
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180);
    }
}
