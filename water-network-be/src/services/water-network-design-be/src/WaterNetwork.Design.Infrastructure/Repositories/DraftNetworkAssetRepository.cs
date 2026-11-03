using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DraftNetworkAssetRepository(DesignDbContext dbContext) : IDraftNetworkAssetRepository
{
    public async Task AddAsync(DraftNetworkAsset draft, CancellationToken ct = default)
    {
        dbContext.Set<DraftNetworkAssetPersistenceModel>().Add(ToModel(draft));
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> drafts, CancellationToken ct = default)
    {
        dbContext.Set<DraftNetworkAssetPersistenceModel>().AddRange(drafts.Select(ToModel));
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task<DraftNetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DraftNetworkAssetPersistenceModel>().AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return m is null ? null : ToDomain(m);
    }

    public async Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(
        string tenantId, string revisionId, CancellationToken ct = default)
    {
        var models = await dbContext.Set<DraftNetworkAssetPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.AssetCode)
            .ToListAsync(ct);
        return models.Select(ToDomain).ToList();
    }

    public async Task UpdateAsync(DraftNetworkAsset draft, CancellationToken ct = default)
    {
        var existing = await dbContext.Set<DraftNetworkAssetPersistenceModel>()
            .FirstOrDefaultAsync(x => x.Id == draft.Id, ct);
        if (existing is null) return;
        existing.Geometry = ToNts(draft.Geometry);
        existing.AttributesJson = JsonSerializer.Serialize(draft.Attributes);
        existing.UpdatedAt = draft.UpdatedAt;
        await dbContext.SaveChangesAsync(ct);
    }

    private static Geometry ToNts(DraftGeometry g) => NtsGeometryConverter.ToNts(g);

    private static DraftNetworkAssetPersistenceModel ToModel(DraftNetworkAsset d) => new()
    {
        Id = d.Id,
        RevisionId = d.RevisionId,
        TenantId = d.TenantId,
        DraftKind = d.Kind.ToString(),
        AssetCode = d.AssetCode,
        ClientRef = d.ClientRef,
        Geometry = ToNts(d.Geometry),
        AttributesJson = JsonSerializer.Serialize(d.Attributes),
        FromRef = d.FromRef,
        ToRef = d.ToRef,
        HostRef = d.HostRef,
        CreatedAt = d.CreatedAt,
        UpdatedAt = d.UpdatedAt
    };

    private static DraftNetworkAsset ToDomain(DraftNetworkAssetPersistenceModel m)
    {
        var coords = m.Geometry.Coordinates.Select(c => new GeoCoordinate(c.X, c.Y)).ToList();
        var type = m.Geometry is Point ? DraftGeometryType.Point : DraftGeometryType.LineString;
        var geometry = new DraftGeometry(type, coords);
        var attributes = JsonSerializer.Deserialize<Dictionary<string, string>>(m.AttributesJson)
            ?? new Dictionary<string, string>();
        return DraftNetworkAsset.Reconstitute(
            m.Id, m.RevisionId, m.TenantId, Enum.Parse<DraftAssetKind>(m.DraftKind), m.AssetCode, m.ClientRef,
            geometry, attributes, m.FromRef, m.ToRef, m.HostRef, m.CreatedAt, m.UpdatedAt);
    }
}
