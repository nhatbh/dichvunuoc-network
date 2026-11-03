using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed class PipeGeometry : ValueObject
{
    public IReadOnlyList<GeoPoint> Points { get; }

    public PipeGeometry(IReadOnlyList<GeoPoint> points)
    {
        if (points.Count < 2)
            throw new DomainException("PipeGeometry.TooFewPoints", "A pipe geometry requires at least 2 points.");

        if (points.Count == 2 && points[0].Equals(points[1]))
            throw new DomainException("PipeGeometry.DegenerateLine", "A pipe geometry cannot start and end at the same point.");

        Points = points.ToList().AsReadOnly();
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        foreach (var point in Points)
            yield return point;
    }
}
