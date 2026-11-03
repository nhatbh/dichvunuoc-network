using System.Text.Json;
using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class CreateDesignImportRequestValidator : AbstractValidator<CreateDesignImportRequest>
{
    public const int MaxAssets = 20_000;
    public CreateDesignImportRequestValidator()
    {
        RuleFor(x => x.ImportKey).NotEmpty().MaximumLength(160).Matches("^[a-zA-Z0-9_.:-]+$");
        RuleFor(x => x.Name).NotEmpty().MaximumLength(160);
        RuleFor(x => x.Provenance).Must(x => x.ValueKind == JsonValueKind.Object)
            .WithMessage("Provenance must be a JSON object.");
        RuleFor(x => x.Assets).NotEmpty().Must(x => x is null || x.Count <= MaxAssets)
            .WithMessage($"An import accepts at most {MaxAssets} assets.");
        RuleForEach(x => x.Assets).NotNull().SetValidator(new CreateDraftAssetRequestValidator());
        RuleForEach(x => x.Assets).ChildRules(asset =>
        {
            asset.RuleFor(x => x.AssetCode).MaximumLength(64);
            asset.RuleFor(x => x.ClientRef).MaximumLength(128);
            asset.RuleFor(x => x.FromRef).MaximumLength(128);
            asset.RuleFor(x => x.ToRef).MaximumLength(128);
            asset.RuleFor(x => x.HostRef).MaximumLength(128);
            asset.RuleFor(x => x.Geometry.Coordinates)
                .Must(coords => coords is null || coords.All(pair => pair is not null
                    && pair.Count == 2 && pair.All(double.IsFinite)))
                .When(x => x.Geometry is not null)
                .WithMessage("Coordinates must contain finite [longitude, latitude] pairs.");
        });
    }
}
