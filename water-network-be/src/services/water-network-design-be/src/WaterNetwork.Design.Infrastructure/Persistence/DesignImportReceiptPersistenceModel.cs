namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignImportReceiptPersistenceModel
{
    public string TenantId { get; set; } = "";
    public string ImportKey { get; set; } = "";
    public string PayloadSha256 { get; set; } = "";
    public string ProjectId { get; set; } = "";
    public string RevisionId { get; set; } = "";
    public int AssetCount { get; set; }
    public string ProvenanceJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
}
