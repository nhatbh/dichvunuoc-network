using System.Globalization;
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Calculates the geodesic length of a pipe in metres by delegating to PostGIS
/// <c>ST_Length(geography(...))</c>.  Using the geography cast ensures the result is
/// returned in metres (not degrees), which is the requirement pinned by the length test.
/// </summary>
public sealed class PipeLengthCalculator(GisDbContext dbContext) : IPipeLengthCalculator
{
    public async Task<double> CalculateMetersAsync(
        IReadOnlyList<(double Lat, double Lng)> points,
        CancellationToken ct = default)
    {
        if (points.Count < 2)
            return 0.0;

        // Build WKT for a LineString: coordinates are "lng lat" per WKT/GeoJSON convention.
        // InvariantCulture is mandatory: comma-decimal locales (vi-VN, de-DE) would emit "0,0009"
        // instead of "0.0009", producing invalid WKT and a PostGIS parse error.
        var coordsList = string.Join(", ", points.Select(p =>
            FormattableString.Invariant($"{p.Lng} {p.Lat}")));
        var wkt = $"LINESTRING({coordsList})";

        const string sql = "SELECT ST_Length(geography(ST_GeomFromText(@wkt, 4326)))";
        var connection = dbContext.Database.GetDbConnection();
        var result = await connection.ExecuteScalarAsync<double>(
            new CommandDefinition(sql, new { wkt }, cancellationToken: ct));

        return result;
    }
}
