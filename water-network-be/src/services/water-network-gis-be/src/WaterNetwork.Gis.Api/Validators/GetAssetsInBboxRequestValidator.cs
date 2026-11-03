using FluentValidation;
using Microsoft.Extensions.Options;
using WaterNetwork.Gis.Application.Configuration;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Contracts.Requests;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class GetAssetsInBboxRequestValidator : AbstractValidator<GetAssetsInBboxRequest>
{
    private static readonly string[] AllowedTypes = ["node", "pipe", "device"];

    public GetAssetsInBboxRequestValidator(IOptions<BboxQueryOptions> options)
    {
        var opt = options.Value;

        RuleFor(x => x.Bbox)
            .NotEmpty().WithMessage("bbox is required (format: minLng,minLat,maxLng,maxLat).");

        RuleFor(x => x).Custom((req, ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Bbox)) return; // NotEmpty already reported it

            if (!Bbox.TryParse(req.Bbox, out var bbox) || bbox is null)
            {
                ctx.AddFailure("Bbox", "bbox must be four comma-separated numbers: minLng,minLat,maxLng,maxLat.");
                return;
            }

            if (bbox.MinLng < -180 || bbox.MaxLng > 180 || bbox.MinLat < -90 || bbox.MaxLat > 90)
                ctx.AddFailure("Bbox", "bbox coordinates out of range (lng [-180,180], lat [-90,90]).");
            if (bbox.MinLng >= bbox.MaxLng)
                ctx.AddFailure("Bbox", "minLng must be less than maxLng.");
            if (bbox.MinLat >= bbox.MaxLat)
                ctx.AddFailure("Bbox", "minLat must be less than maxLat.");
            if (bbox.AreaSquareDegrees > opt.MaxAreaSquareDegrees)
                ctx.AddFailure("Bbox", $"bbox area too large (max {opt.MaxAreaSquareDegrees} deg²). Zoom in.");
        });

        RuleFor(x => x.Limit)
            .Must(l => l is null or > 0).WithMessage("limit must be greater than 0.")
            .Must(l => l is null || l <= opt.MaxLimit).WithMessage($"limit must not exceed {opt.MaxLimit}.");

        RuleFor(x => x.Types)
            .Must(BeValidTypes).WithMessage("types must be a comma-separated subset of: node, pipe, device.");
    }

    private static bool BeValidTypes(string? types)
    {
        if (string.IsNullOrWhiteSpace(types)) return true; // default = all
        return types
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .All(t => AllowedTypes.Contains(t, StringComparer.OrdinalIgnoreCase));
    }
}
