using System.Globalization;
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class PipeReadDao(GisDbContext dbContext) : IPipeReadDao
{
    // Flat Dapper materialization row — mirrors the SQL column list exactly.
    // GeometryWkt holds the ST_AsText result; Points are projected after deserialization.
    private sealed record PipeRow(
        string Id,
        string AssetCode,
        string FromNodeId,
        string ToNodeId,
        string GeometryWkt,
        int DiameterMm,
        string Material,
        double LengthM,
        string? LengthValidationWarning,
        string Status,
        int Version,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    public async Task<PipeDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id                         AS Id,
                   asset_code                 AS AssetCode,
                   from_node_id               AS FromNodeId,
                   to_node_id                 AS ToNodeId,
                   ST_AsText(geometry)        AS GeometryWkt,
                   diameter_mm                AS DiameterMm,
                   material                   AS Material,
                   length_m                   AS LengthM,
                   length_validation_warning   AS LengthValidationWarning,
                   status                     AS Status,
                   version                    AS Version,
                   created_at                 AS CreatedAt,
                   updated_at                 AS UpdatedAt
            FROM network_pipes
            WHERE id = @id AND tenant_id = @tenantId AND deleted_at IS NULL
            """;

        var connection = dbContext.Database.GetDbConnection();
        var row = await connection.QuerySingleOrDefaultAsync<PipeRow>(
            new CommandDefinition(sql, new { id, tenantId }, cancellationToken: ct));

        if (row is null)
            return null;

        var points = ParseWkt(row.GeometryWkt);

        return new PipeDetailDto(
            Id: row.Id,
            AssetCode: row.AssetCode,
            FromNodeId: row.FromNodeId,
            ToNodeId: row.ToNodeId,
            Points: points,
            DiameterMm: (double)row.DiameterMm,
            Material: row.Material,
            LengthM: row.LengthM,
            LengthValidationWarning: row.LengthValidationWarning,
            Status: row.Status,
            Version: row.Version,
            CreatedAt: row.CreatedAt,
            UpdatedAt: row.UpdatedAt);
    }

    /// <summary>
    /// Parses a PostGIS WKT LINESTRING of the form:
    ///   LINESTRING(lng1 lat1,lng2 lat2,...)
    /// PostGIS stores geometry as (X=longitude, Y=latitude).
    /// Always use InvariantCulture for floating-point parsing.
    /// Assumes 2D LINESTRING — column type (geometry(LINESTRING,4326)) enforces this.
    /// </summary>
    private static IReadOnlyList<GeoPointDto> ParseWkt(string wkt)
    {
        // Strip the "LINESTRING(" prefix and the closing ")"
        const string prefix = "LINESTRING(";
        if (!wkt.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return Array.Empty<GeoPointDto>();

        var inner = wkt[prefix.Length..^1]; // everything between "LINESTRING(" and ")"
        var pairs = inner.Split(',');
        var points = new List<GeoPointDto>(pairs.Length);

        foreach (var pair in pairs)
        {
            var parts = pair.Trim().Split(' ');
            if (parts.Length < 2) continue;

            // PostGIS WKT: X = longitude, Y = latitude
            var lng = double.Parse(parts[0], CultureInfo.InvariantCulture);
            var lat = double.Parse(parts[1], CultureInfo.InvariantCulture);
            points.Add(new GeoPointDto(Lat: lat, Lng: lng));
        }

        return points;
    }
}
