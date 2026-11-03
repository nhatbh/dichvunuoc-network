using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class GeoPointTests
{
    [Fact]
    public void Creates_Valid_Point()
    {
        var point = new GeoPoint(10.762622, 106.660172);
        point.Latitude.Should().Be(10.762622);
        point.Longitude.Should().Be(106.660172);
    }

    [Theory]
    [InlineData(-90.01)]
    [InlineData(90.01)]
    public void Rejects_Invalid_Latitude(double lat)
    {
        var act = () => new GeoPoint(lat, 106.0);
        act.Should().Throw<DomainException>();
    }

    [Theory]
    [InlineData(-180.01)]
    [InlineData(180.01)]
    public void Rejects_Invalid_Longitude(double lng)
    {
        var act = () => new GeoPoint(10.0, lng);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Equality_By_Value()
    {
        new GeoPoint(10, 106).Should().Be(new GeoPoint(10, 106));
    }
}
