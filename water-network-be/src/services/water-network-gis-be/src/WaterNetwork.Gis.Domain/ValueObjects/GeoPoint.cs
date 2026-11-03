using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed class GeoPoint : ValueObject
{
    public const int Srid = 4326;

    public double Latitude { get; }
    public double Longitude { get; }

    public GeoPoint(double latitude, double longitude)
    {
        if (latitude is < -90 or > 90)
            throw new DomainException("GeoPoint.InvalidLatitude", $"Latitude {latitude} must be between -90 and 90.");
        if (longitude is < -180 or > 180)
            throw new DomainException("GeoPoint.InvalidLongitude", $"Longitude {longitude} must be between -180 and 180.");
        Latitude = latitude;
        Longitude = longitude;
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Latitude;
        yield return Longitude;
    }
}
