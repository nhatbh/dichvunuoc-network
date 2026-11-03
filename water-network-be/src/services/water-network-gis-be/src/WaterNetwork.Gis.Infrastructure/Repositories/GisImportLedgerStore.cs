using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class GisImportLedgerStore(GisDbContext dbContext) : IGisImportLedgerStore
{
    public async Task<string?> GetExistingAsync(string revisionId, string draftAssetId, CancellationToken ct)
        => await dbContext.Set<GisImportLedgerPersistenceModel>().AsNoTracking()
            .Where(x => x.RevisionId == revisionId && x.DraftAssetId == draftAssetId)
            .Select(x => x.GisAssetId)
            .FirstOrDefaultAsync(ct);

    public async Task RecordAsync(string tenantId, string revisionId, string draftAssetId,
        string gisAssetId, string kind, string assetCode, CancellationToken ct)
    {
        dbContext.Set<GisImportLedgerPersistenceModel>().Add(new GisImportLedgerPersistenceModel
        {
            Id = Guid.CreateVersion7().ToString(),
            TenantId = tenantId,
            RevisionId = revisionId,
            DraftAssetId = draftAssetId,
            GisAssetId = gisAssetId,
            Kind = kind,
            AssetCode = assetCode,
            CreatedAt = DateTime.UtcNow
        });
        try
        {
            await dbContext.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            dbContext.ChangeTracker.Clear();   // concurrent redelivery already recorded — idempotent no-op
        }
    }
}
