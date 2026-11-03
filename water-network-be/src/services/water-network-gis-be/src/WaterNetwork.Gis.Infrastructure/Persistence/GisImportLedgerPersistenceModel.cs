namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class GisImportLedgerPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string RevisionId { get; set; } = default!;
    public string DraftAssetId { get; set; } = default!;
    public string GisAssetId { get; set; } = default!;
    public string Kind { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
}
