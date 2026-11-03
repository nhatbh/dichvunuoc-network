namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignRevisionPersistenceModel
{
    public string Id { get; set; } = default!;
    public string ProjectId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public int RevisionNumber { get; set; }
    public string Status { get; set; } = default!;
    public string? ValidationResultJson { get; set; }
    public string? NetworkEditsJson { get; set; }
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<DesignRevisionTransitionPersistenceModel> Transitions { get; set; } = [];
}
