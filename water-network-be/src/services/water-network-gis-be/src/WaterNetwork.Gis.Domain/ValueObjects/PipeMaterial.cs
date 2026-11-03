using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed class PipeMaterial : ValueObject
{
    private static readonly IReadOnlyDictionary<string, string> Catalog =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "HDPE",        "HDPE"        },
            { "PVC",         "PVC"         },
            { "DuctileIron", "DuctileIron" },
            { "Steel",       "Steel"       },
            { "CastIron",    "CastIron"    },
            { "Concrete",    "Concrete"    },
        };

    private readonly string _canonical;

    private PipeMaterial(string canonical)
    {
        _canonical = canonical;
    }

    public static PipeMaterial Parse(string value)
    {
        if (Catalog.TryGetValue(value?.Trim() ?? string.Empty, out var canonical))
            return new PipeMaterial(canonical);

        throw new DomainException("PipeMaterial.Invalid",
            $"'{value}' is not a recognised pipe material. Valid values: {string.Join(", ", Catalog.Values.Distinct())}.");
    }

    public override string ToString() => _canonical;

    protected override IEnumerable<object?> GetEqualityComponents() => new object?[] { _canonical };
}
