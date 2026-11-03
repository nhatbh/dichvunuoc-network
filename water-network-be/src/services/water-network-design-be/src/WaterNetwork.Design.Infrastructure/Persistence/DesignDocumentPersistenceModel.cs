namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignDocumentPersistenceModel
{
    public string Id { get; set; } = default!;
    public string ProjectId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string FileName { get; set; } = default!;
    public string ContentType { get; set; } = default!;
    public long SizeBytes { get; set; }
    public string FileRef { get; set; } = default!;
    public string DocumentType { get; set; } = default!;
    public string UploadedBy { get; set; } = default!;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
