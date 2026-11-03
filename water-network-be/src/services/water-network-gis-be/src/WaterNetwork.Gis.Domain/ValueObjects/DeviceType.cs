using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed class DeviceType : ValueObject
{
    private static readonly IReadOnlyDictionary<string, string> Catalog =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "Valve",          "Valve"          },
            { "FlowMeter",      "FlowMeter"      },
            { "PressureSensor", "PressureSensor" },
            { "Pump",           "Pump"           },
            { "Hydrant",        "Hydrant"        },
        };

    private readonly string _canonical;

    private DeviceType(string canonical)
    {
        _canonical = canonical;
    }

    public static DeviceType Parse(string value)
    {
        if (Catalog.TryGetValue(value?.Trim() ?? string.Empty, out var canonical))
            return new DeviceType(canonical);

        throw new DomainException("DeviceType.Invalid",
            $"'{value}' is not a recognised device type. Valid values: {string.Join(", ", Catalog.Values.Distinct())}.");
    }

    public override string ToString() => _canonical;

    protected override IEnumerable<object?> GetEqualityComponents() => new object?[] { _canonical };
}
