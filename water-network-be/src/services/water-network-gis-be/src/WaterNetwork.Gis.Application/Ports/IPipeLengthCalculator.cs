namespace WaterNetwork.Gis.Application.Ports;

/// <summary>
/// Calculates the total length in metres of a pipe defined by an ordered
/// sequence of geographic points.  Returns the ellipsoidal (WGS-84) length in
/// metres by delegating to the persistence layer (<c>ST_Length(geography(...))</c>
/// via PostGIS).  The port is kept pure so the Application layer never depends
/// on a specific calculation engine.
/// </summary>
public interface IPipeLengthCalculator
{
    Task<double> CalculateMetersAsync(
        IReadOnlyList<(double Lat, double Lng)> points,
        CancellationToken ct = default);
}
