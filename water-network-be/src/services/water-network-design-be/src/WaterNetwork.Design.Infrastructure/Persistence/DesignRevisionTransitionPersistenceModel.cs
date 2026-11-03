namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignRevisionTransitionPersistenceModel
{
    public long Id { get; set; }
    public string RevisionId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string FromStatus { get; set; } = default!;
    public string ToStatus { get; set; } = default!;
    public string ActorId { get; set; } = default!;
    public string? Reason { get; set; }
    public string? CorrelationId { get; set; }
    public DateTime OccurredAt { get; set; }
}
