using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.Domain.Entities;

/// <summary>Append-only audit record of a single lifecycle transition.</summary>
public sealed class AssetLifecycleEntry
{
    public AssetStatus FromStatus { get; }
    public AssetStatus ToStatus { get; }
    public string ActorId { get; }
    public string? Reason { get; }
    public DateTime OccurredAt { get; }

    public AssetLifecycleEntry(AssetStatus fromStatus, AssetStatus toStatus, string actorId, string? reason, DateTime occurredAt)
    {
        FromStatus = fromStatus;
        ToStatus = toStatus;
        ActorId = actorId;
        Reason = reason;
        OccurredAt = occurredAt;
    }
}
