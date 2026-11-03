// DraftGeometryFactoryTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftGeometryFactoryTests
{
    private static readonly IReadOnlyList<double> PointCoord = new[] { 105.8, 21.0 };
    private static readonly IReadOnlyList<double> SingleElem = new[] { 105.8 };

    [Fact]
    public void Builds_Point_From_Single_Coordinate_Pair()
    {
        var input = new DraftGeometryInput("Point", new[] { PointCoord });
        var g = DraftGeometryFactory.FromInput(input);
        g.Type.Should().Be(DraftGeometryType.Point);
        g.Coordinates[0].Longitude.Should().Be(105.8);
    }

    [Fact]
    public void Unknown_Type_Throws_DomainException()
    {
        var input = new DraftGeometryInput("Polygon", new[] { PointCoord });
        var act = () => DraftGeometryFactory.FromInput(input);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.UnknownType");
    }

    [Fact]
    public void Coordinate_Pair_Of_Wrong_Length_Throws()
    {
        var input = new DraftGeometryInput("Point", new[] { SingleElem });
        var act = () => DraftGeometryFactory.FromInput(input);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DraftGeometry.BadCoordinate");
    }
}
