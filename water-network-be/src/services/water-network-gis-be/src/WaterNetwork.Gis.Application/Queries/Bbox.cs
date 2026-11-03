using System.Globalization;

namespace WaterNetwork.Gis.Application.Queries;

/// <summary>
/// Parses the "minLng,minLat,maxLng,maxLat" bbox query parameter (GeoJSON axis
/// order: west,south,east,north). Shared by the request validator and the
/// endpoint mapper so parsing rules live in exactly one place.
/// </summary>
public sealed record Bbox(double MinLng, double MinLat, double MaxLng, double MaxLat)
{
    public double AreaSquareDegrees => Math.Abs(MaxLng - MinLng) * Math.Abs(MaxLat - MinLat);

    public static bool TryParse(string? raw, out Bbox? bbox)
    {
        bbox = null;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var parts = raw.Split(',', StringSplitOptions.TrimEntries);
        if (parts.Length != 4) return false;

        var values = new double[4];
        for (var i = 0; i < 4; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i]))
                return false;
        }

        bbox = new Bbox(values[0], values[1], values[2], values[3]);
        return true;
    }
}
