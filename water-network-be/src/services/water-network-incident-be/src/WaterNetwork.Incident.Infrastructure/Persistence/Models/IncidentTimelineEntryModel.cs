namespace WaterNetwork.Incident.Infrastructure.Persistence.Models;

public sealed class IncidentTimelineEntryModel
{
    public string Id { get; set; } = default!;
    public string IncidentId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string EntryType { get; set; } = default!;
    public string ActorId { get; set; } = default!;
    public string? Note { get; set; }
    public DateTime OccurredAt { get; set; }
    public int Sequence { get; set; }
}
