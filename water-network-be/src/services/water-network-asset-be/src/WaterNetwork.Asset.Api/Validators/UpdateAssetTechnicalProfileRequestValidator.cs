using FluentValidation;
using WaterNetwork.Asset.Contracts.Requests;

namespace WaterNetwork.Asset.Api.Validators;

public sealed class UpdateAssetTechnicalProfileRequestValidator : AbstractValidator<UpdateAssetTechnicalProfileRequest>
{
    public UpdateAssetTechnicalProfileRequestValidator()
    {
        When(r => r.InstallationYear.HasValue, () =>
            RuleFor(r => r.InstallationYear!.Value).InclusiveBetween(1900, 2100));
        RuleFor(r => r.Manufacturer).MaximumLength(128);
        RuleFor(r => r.Model).MaximumLength(128);
    }
}
