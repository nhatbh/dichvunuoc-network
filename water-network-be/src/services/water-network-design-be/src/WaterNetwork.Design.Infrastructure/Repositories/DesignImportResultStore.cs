using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignImportResultStore(DesignDbContext dbContext) : IDesignImportResultStore
{
    public async Task SaveResultsAsync(string tenantId, string revisionId,
        IReadOnlyList<ImportResultRow> rows, CancellationToken ct)
    {
        // Idempotent re-write: clear prior rows for this revision, then insert.
        var set = dbContext.Set<DesignImportResultPersistenceModel>();
        var existing = await set.Where(x => x.TenantId == tenantId && x.RevisionId == revisionId).ToListAsync(ct);
        set.RemoveRange(existing);
        foreach (var r in rows)
            set.Add(new DesignImportResultPersistenceModel
            {
                Id = Guid.CreateVersion7().ToString(),
                TenantId = tenantId,
                RevisionId = revisionId,
                DraftAssetId = r.DraftAssetId,
                GisAssetId = r.GisAssetId,
                Status = r.Status,
                Reason = r.Reason,
                CreatedAt = DateTime.UtcNow
            });
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<ImportResultRow>> ListAsync(string tenantId, string revisionId, CancellationToken ct)
        => await dbContext.Set<DesignImportResultPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.DraftAssetId)
            .Select(x => new ImportResultRow(x.DraftAssetId, x.GisAssetId, x.Status, x.Reason))
            .ToListAsync(ct);
}
