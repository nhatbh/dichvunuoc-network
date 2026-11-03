namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignProjectPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string? BranchId { get; set; }
    public string? ZoneId { get; set; }
    public string Status { get; set; } = default!;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
