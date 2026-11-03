namespace WaterNetwork.Gis.Application.Commands;

/// <summary>
/// Shared GeoJSON formatting helpers for command handlers.
/// </summary>
internal static class GeoJsonHelper
{
    /// <summary>
    /// Produces a GeoJSON Point string. Coordinates are [longitude, latitude] per RFC 7946.
    /// </summary>
    internal static string GeoJsonPoint(double lng, double lat)
        => $"{{\"type\":\"Point\",\"coordinates\":[{lng.ToString(System.Globalization.CultureInfo.InvariantCulture)},{lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}]}}";
}
