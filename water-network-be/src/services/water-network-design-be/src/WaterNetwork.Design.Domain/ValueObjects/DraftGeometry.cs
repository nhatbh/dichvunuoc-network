// DraftGeometry.cs
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Design.Domain.ValueObjects;

public sealed class DraftGeometry : ValueObject
{
    public DraftGeometryType Type { get; }
    public IReadOnlyList<GeoCoordinate> Coordinates { get; }

    public DraftGeometry(DraftGeometryType type, IReadOnlyList<GeoCoordinate> coordinates)
    {
        if (type == DraftGeometryType.Point && coordinates.Count != 1)
            throw new DomainException("DraftGeometry.PointArity", "A Point geometry requires exactly 1 coordinate.");
        if (type == DraftGeometryType.LineString && coordinates.Count < 2)
            throw new DomainException("DraftGeometry.LineStringArity", "A LineString geometry requires at least 2 coordinates.");

        Type = type;
        Coordinates = coordinates.ToList().AsReadOnly();
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Type;
        foreach (var c in Coordinates)
            yield return c;
    }
}
