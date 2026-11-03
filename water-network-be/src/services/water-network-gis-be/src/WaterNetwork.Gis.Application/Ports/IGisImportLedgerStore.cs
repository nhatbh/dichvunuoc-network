namespace WaterNetwork.Gis.Application.Ports;

public interface IGisImportLedgerStore
{
    Task<string?> GetExistingAsync(string revisionId, string draftAssetId, CancellationToken ct);
    Task RecordAsync(string tenantId, string revisionId, string draftAssetId,
        string gisAssetId, string kind, string assetCode, CancellationToken ct);
}
