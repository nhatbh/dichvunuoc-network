using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class UpdateDraftGeometryRequestValidator : AbstractValidator<UpdateDraftGeometryRequest>
{
    private static readonly string[] GeomTypes = { "Point", "LineString" };

    public UpdateDraftGeometryRequestValidator()
    {
        RuleFor(x => x.Geometry).NotNull();
        RuleFor(x => x.Geometry.Type).Must(t => GeomTypes.Contains(t))
            .When(x => x.Geometry is not null).WithMessage("Geometry.Type must be Point or LineString.");
        RuleFor(x => x.Geometry.Coordinates).NotEmpty().When(x => x.Geometry is not null);
    }
}
