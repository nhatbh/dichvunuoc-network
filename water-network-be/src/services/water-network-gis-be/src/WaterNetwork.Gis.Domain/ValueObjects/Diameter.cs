using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed class Diameter : ValueObject
{
    public double Value { get; }

    public Diameter(double value)
    {
        if (value <= 0)
            throw new DomainException("Diameter.NotPositive", $"Diameter {value} must be positive.");
        if (value > 4000)
            throw new DomainException("Diameter.TooLarge", $"Diameter {value} mm exceeds the maximum allowed value of 4000 mm.");

        Value = value;
    }

    protected override IEnumerable<object?> GetEqualityComponents() => new object?[] { Value };
}
