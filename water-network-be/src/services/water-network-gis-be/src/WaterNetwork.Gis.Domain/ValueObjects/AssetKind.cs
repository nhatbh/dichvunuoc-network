using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

/// <summary>Identifies the kind of network asset a geometry version belongs to.</summary>
public sealed class AssetKind : ValueObject
{
    private static readonly IReadOnlyDictionary<string, string> Catalog =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "Node",   "Node"   },
            { "Pipe",   "Pipe"   },
            { "Device", "Device" },
        };

    private readonly string _canonical;

    private AssetKind(string canonical)
    {
        _canonical = canonical;
    }

    public static AssetKind Parse(string value)
    {
        if (Catalog.TryGetValue(value?.Trim() ?? string.Empty, out var canonical))
            return new AssetKind(canonical);

        throw new DomainException("AssetKind.Invalid",
            $"'{value}' is not a recognised asset kind. Valid values: {string.Join(", ", Catalog.Values.Distinct())}.");
    }

    public override string ToString() => _canonical;

    protected override IEnumerable<object?> GetEqualityComponents() => new object?[] { _canonical };
}
