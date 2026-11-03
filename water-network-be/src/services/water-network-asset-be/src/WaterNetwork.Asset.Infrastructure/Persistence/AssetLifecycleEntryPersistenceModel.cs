namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class AssetLifecycleEntryPersistenceModel
{
    public long Id { get; set; }
    public string AssetId { get; set; } = default!;
    public string FromStatus { get; set; } = default!;
    public string ToStatus { get; set; } = default!;
    public string ActorId { get; set; } = default!;
    public string? Reason { get; set; }
    public DateTime OccurredAt { get; set; }
}
