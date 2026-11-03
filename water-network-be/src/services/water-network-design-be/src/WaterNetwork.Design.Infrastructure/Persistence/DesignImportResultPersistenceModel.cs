namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignImportResultPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string RevisionId { get; set; } = default!;
    public string DraftAssetId { get; set; } = default!;
    public string? GisAssetId { get; set; }
    public string Status { get; set; } = default!;   // "imported" | "failed"
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; }
}
