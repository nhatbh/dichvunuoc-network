using FluentValidation;
using WaterNetwork.Gis.Application.Commands;

namespace WaterNetwork.Gis.Application.Validators;

public sealed class RelocateNodeCommandValidator : AbstractValidator<RelocateNodeCommand>
{
    public RelocateNodeCommandValidator()
    {
        RuleFor(x => x.NodeId).NotEmpty();
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90);
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180);
    }
}
