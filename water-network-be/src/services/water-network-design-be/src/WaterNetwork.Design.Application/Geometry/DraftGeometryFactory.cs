// DraftGeometryFactory.cs
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.Application.Geometry;

public static class DraftGeometryFactory
{
    public static DraftGeometry FromInput(DraftGeometryInput input)
    {
        var type = input.Type switch
        {
            "Point" => DraftGeometryType.Point,
            "LineString" => DraftGeometryType.LineString,
            _ => throw new DomainException("DraftGeometry.UnknownType",
                $"Geometry type '{input.Type}' is not supported (use Point or LineString).")
        };

        var coords = new List<GeoCoordinate>(input.Coordinates.Count);
        foreach (var pair in input.Coordinates)
        {
            if (pair.Count != 2)
                throw new DomainException("DraftGeometry.BadCoordinate",
                    "Each coordinate must be a [longitude, latitude] pair.");
            coords.Add(new GeoCoordinate(pair[0], pair[1]));
        }

        return new DraftGeometry(type, coords);
    }
}
