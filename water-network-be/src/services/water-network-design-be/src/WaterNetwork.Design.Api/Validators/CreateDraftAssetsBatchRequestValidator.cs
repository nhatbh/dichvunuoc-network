using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class CreateDraftAssetsBatchRequestValidator : AbstractValidator<CreateDraftAssetsBatchRequest>
{
    public CreateDraftAssetsBatchRequestValidator()
    {
        RuleFor(x => x.Assets).NotEmpty().WithMessage("At least one asset is required.");
        RuleForEach(x => x.Assets).SetValidator(new CreateDraftAssetRequestValidator());
    }
}
