namespace WaterNetwork.Incident.Application.Dtos;

public sealed record TimelineEntryDto(string EntryType, string ActorId, string? Note, DateTime OccurredAt, int Sequence);
