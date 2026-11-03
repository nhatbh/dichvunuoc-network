// DraftGeometryTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftGeometryTests
{
    [Fact]
    public void Point_Requires_Exactly_One_Coordinate()
    {
        var act = () => new DraftGeometry(DraftGeometryType.Point,
            new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.9, 21.1) });
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.PointArity");
    }

    [Fact]
    public void LineString_Requires_At_Least_Two_Coordinates()
    {
        var act = () => new DraftGeometry(DraftGeometryType.LineString,
            new[] { new GeoCoordinate(105.8, 21.0) });
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.LineStringArity");
    }

    [Fact]
    public void GeoCoordinate_Rejects_Out_Of_Range_Latitude()
    {
        var act = () => new GeoCoordinate(105.8, 999);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("GeoCoordinate.InvalidLatitude");
    }

    [Fact]
    public void Valid_Point_Is_Constructed()
    {
        var g = new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) });
        g.Type.Should().Be(DraftGeometryType.Point);
        g.Coordinates.Should().HaveCount(1);
    }
}
