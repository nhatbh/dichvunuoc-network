using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class RegisterNodeRequestValidator : AbstractValidator<RegisterNodeRequest>
{
    public RegisterNodeRequestValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.NodeType).NotEmpty();
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90);
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180);
    }
}
