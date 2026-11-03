using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class PipeGeometryTests
{
    private static readonly GeoPoint A = new(10.0, 106.0);
    private static readonly GeoPoint B = new(10.1, 106.1);
    private static readonly GeoPoint C = new(10.2, 106.2);

    [Fact]
    public void Rejects_Empty_List()
    {
        var act = () => new PipeGeometry(new List<GeoPoint>());
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("PipeGeometry.TooFewPoints");
    }

    [Fact]
    public void Rejects_Single_Point()
    {
        var act = () => new PipeGeometry(new List<GeoPoint> { A });
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("PipeGeometry.TooFewPoints");
    }

    [Fact]
    public void Rejects_Two_Identical_Points()
    {
        var act = () => new PipeGeometry(new List<GeoPoint> { A, A });
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("PipeGeometry.DegenerateLine");
    }

    [Fact]
    public void Accepts_Two_Distinct_Points_And_Preserves_Order()
    {
        var pg = new PipeGeometry(new List<GeoPoint> { A, B });
        pg.Points.Should().HaveCount(2);
        pg.Points[0].Should().Be(A);
        pg.Points[1].Should().Be(B);
    }

    [Fact]
    public void Accepts_Multiple_Points_And_Preserves_Order()
    {
        var pg = new PipeGeometry(new List<GeoPoint> { A, B, C });
        pg.Points.Should().HaveCount(3);
        pg.Points[0].Should().Be(A);
        pg.Points[1].Should().Be(B);
        pg.Points[2].Should().Be(C);
    }

    [Fact]
    public void Equality_By_Full_Points_List()
    {
        var pg1 = new PipeGeometry(new List<GeoPoint> { A, B });
        var pg2 = new PipeGeometry(new List<GeoPoint> { A, B });
        pg1.Should().Be(pg2);
    }

    [Fact]
    public void Not_Equal_When_Points_Differ()
    {
        var pg1 = new PipeGeometry(new List<GeoPoint> { A, B });
        var pg2 = new PipeGeometry(new List<GeoPoint> { A, C });
        pg1.Should().NotBe(pg2);
    }

    [Fact]
    public void Not_Equal_When_Order_Differs()
    {
        var pg1 = new PipeGeometry(new List<GeoPoint> { A, B });
        var pg2 = new PipeGeometry(new List<GeoPoint> { B, A });
        pg1.Should().NotBe(pg2);
    }
}
