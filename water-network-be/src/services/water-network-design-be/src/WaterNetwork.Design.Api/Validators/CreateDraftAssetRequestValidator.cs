using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class CreateDraftAssetRequestValidator : AbstractValidator<CreateDraftAssetRequest>
{
    private static readonly string[] Kinds = { "Node", "Pipe", "Device" };
    private static readonly string[] GeomTypes = { "Point", "LineString" };

    public CreateDraftAssetRequestValidator()
    {
        RuleFor(x => x.Kind).Must(k => Kinds.Contains(k)).WithMessage("Kind must be Node, Pipe or Device.");
        RuleFor(x => x.AssetCode).NotEmpty();
        RuleFor(x => x.Geometry).NotNull();
        RuleFor(x => x.Geometry.Type).Must(t => GeomTypes.Contains(t))
            .When(x => x.Geometry is not null).WithMessage("Geometry.Type must be Point or LineString.");
        RuleFor(x => x.Geometry.Coordinates).NotEmpty()
            .When(x => x.Geometry is not null);
    }
}
