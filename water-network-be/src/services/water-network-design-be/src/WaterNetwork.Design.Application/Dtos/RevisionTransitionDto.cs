namespace WaterNetwork.Design.Application.Dtos;

public sealed record RevisionTransitionDto(
    string FromStatus,
    string ToStatus,
    string ActorId,
    string? Reason,
    string? CorrelationId,
    DateTime OccurredAt);
