// NtsGeometryConverterTests.cs
using FluentAssertions;
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class NtsGeometryConverterTests
{
    [Fact]
    public void Point_Converts_With_Srid_4326_And_Lng_Lat_Order()
    {
        var g = new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) });
        var nts = NtsGeometryConverter.ToNts(g);
        nts.Should().BeOfType<Point>();
        nts.SRID.Should().Be(4326);
        nts.Coordinate.X.Should().Be(105.8); // X = longitude
        nts.Coordinate.Y.Should().Be(21.0);  // Y = latitude
    }

    [Fact]
    public void LineString_Converts_All_Coordinates()
    {
        var g = new DraftGeometry(DraftGeometryType.LineString,
            new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.9, 21.1) });
        var nts = NtsGeometryConverter.ToNts(g);
        nts.Should().BeOfType<LineString>();
        nts.Coordinates.Should().HaveCount(2);
    }
}
