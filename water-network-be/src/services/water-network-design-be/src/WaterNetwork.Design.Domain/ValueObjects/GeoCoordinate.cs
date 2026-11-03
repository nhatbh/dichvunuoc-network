// GeoCoordinate.cs
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Design.Domain.ValueObjects;

public sealed class GeoCoordinate : ValueObject
{
    public const int Srid = 4326;

    public double Longitude { get; }
    public double Latitude { get; }

    public GeoCoordinate(double longitude, double latitude)
    {
        if (latitude is < -90 or > 90)
            throw new DomainException("GeoCoordinate.InvalidLatitude", $"Latitude {latitude} must be between -90 and 90.");
        if (longitude is < -180 or > 180)
            throw new DomainException("GeoCoordinate.InvalidLongitude", $"Longitude {longitude} must be between -180 and 180.");
        Longitude = longitude;
        Latitude = latitude;
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Longitude;
        yield return Latitude;
    }
}
