using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Domain.Entities;

/// <summary>Append-only audit entry on an incident's timeline.</summary>
public sealed record IncidentTimelineEntry(
    string Id,
    TimelineEntryType EntryType,
    string ActorId,
    string? Note,
    DateTime OccurredAt,
    int Sequence)
{
    public static IncidentTimelineEntry Create(TimelineEntryType type, string actorId, string? note, int sequence)
        => new(Guid.CreateVersion7().ToString(), type, actorId, note, DateTime.UtcNow, sequence);
}
