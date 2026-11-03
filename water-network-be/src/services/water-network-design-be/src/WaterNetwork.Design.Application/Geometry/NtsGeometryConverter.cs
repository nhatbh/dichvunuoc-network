// NtsGeometryConverter.cs
using NetTopologySuite;
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.Application.Geometry;

/// <summary>Converts a Domain <see cref="DraftGeometry"/> (NTS-free) into a NetTopologySuite
/// geometry (SRID 4326, X=longitude, Y=latitude — matching gis-be).</summary>
public static class NtsGeometryConverter
{
    private static readonly GeometryFactory Factory =
        NtsGeometryServices.Instance.CreateGeometryFactory(GeoCoordinate.Srid);

    public static NetTopologySuite.Geometries.Geometry ToNts(DraftGeometry geometry) => geometry.Type switch
    {
        DraftGeometryType.Point => Factory.CreatePoint(ToCoordinate(geometry.Coordinates[0])),
        DraftGeometryType.LineString => Factory.CreateLineString(
            geometry.Coordinates.Select(ToCoordinate).ToArray()),
        _ => throw new ArgumentOutOfRangeException(nameof(geometry), geometry.Type, "Unknown geometry type.")
    };

    private static Coordinate ToCoordinate(GeoCoordinate c) => new(c.Longitude, c.Latitude);
}
