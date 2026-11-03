using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.Domain.Entities;

/// <summary>Append-only audit record of a single revision state transition.</summary>
public sealed class DesignRevisionTransition
{
    public DesignRevisionStatus FromStatus { get; }
    public DesignRevisionStatus ToStatus { get; }
    public string ActorId { get; }
    public string? Reason { get; }
    public string? CorrelationId { get; }
    public DateTime OccurredAt { get; }

    public DesignRevisionTransition(
        DesignRevisionStatus fromStatus, DesignRevisionStatus toStatus,
        string actorId, string? reason, string? correlationId, DateTime occurredAt)
    {
        FromStatus = fromStatus;
        ToStatus = toStatus;
        ActorId = actorId;
        Reason = reason;
        CorrelationId = correlationId;
        OccurredAt = occurredAt;
    }
}
