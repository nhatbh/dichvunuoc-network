using FluentValidation;
using WaterNetwork.Asset.Application.Commands;

namespace WaterNetwork.Asset.Application.Validators;

public sealed class UpdateAssetTechnicalProfileCommandValidator : AbstractValidator<UpdateAssetTechnicalProfileCommand>
{
    public UpdateAssetTechnicalProfileCommandValidator()
    {
        RuleFor(c => c.AssetId).NotEmpty();
        When(c => c.InstallationYear.HasValue, () =>
            RuleFor(c => c.InstallationYear!.Value).InclusiveBetween(1900, 2100));
        RuleFor(c => c.Manufacturer).MaximumLength(128);
        RuleFor(c => c.Model).MaximumLength(128);
    }
}
