namespace WaterNetwork.Gis.Infrastructure.Persistence;
/// <summary>Terminal receipt for both successful and rejected atomic edits.</summary>
public sealed class NetworkEditBatchPersistenceModel
{
    public string RevisionId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string Status { get; set; } = default!;
    public DateTime CompletedAt { get; set; }
}
