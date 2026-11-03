using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class GeometryVersionStore(GisDbContext dbContext) : IGeometryVersionStore
{
    public async Task<int> GetNextVersionAsync(string assetId, CancellationToken ct = default)
    {
        var max = await dbContext.GeometryVersions
            .Where(x => x.AssetId == assetId)
            .Select(x => (int?)x.Version)
            .MaxAsync(ct);
        return (max ?? 0) + 1;
    }

    /// <summary>
    /// Stages the geometry version row (Add only). Does NOT call SaveChanges.
    /// The aggregate repository's outbox transaction commits everything atomically on the same scoped GisDbContext.
    /// </summary>
    public Task AppendAsync(GeometryVersion version, CancellationToken ct = default)
    {
        dbContext.GeometryVersions.Add(ToModel(version));
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<GeometryVersion>> ListByAssetAsync(string assetId, CancellationToken ct = default)
    {
        var rows = await dbContext.GeometryVersions.AsNoTracking()
            .Where(x => x.AssetId == assetId)
            .OrderByDescending(x => x.Version)
            .ToListAsync(ct);
        return rows.Select(ToDomain).ToList();
    }

    private static GeometryVersionPersistenceModel ToModel(GeometryVersion v) => new()
    {
        Id = v.Id,
        AssetId = v.AssetId,
        AssetKind = v.AssetKind.ToString(),
        Version = v.Version,
        Geometry = null, // TODO GIS-3: populate NTS geometry from GeoJson when geometry-column write is wired
        GeoJson = v.GeoJson,
        ChangedBy = v.ChangedBy,
        Reason = v.Reason,
        ChangedAt = v.ChangedAt
    };

    private static GeometryVersion ToDomain(GeometryVersionPersistenceModel m)
        => GeometryVersion.Reconstitute(
            m.Id, m.AssetId, AssetKind.Parse(m.AssetKind),
            m.Version, m.GeoJson, m.ChangedBy, m.Reason, m.ChangedAt);
}
