namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IsolationPlanDto(
    string Id, string Status, string StartNodeId, long GraphVersion,
    IReadOnlyList<string> ValvesToClose, IReadOnlyList<string> IsolatedNodes, IReadOnlyList<string> IsolatedPipes,
    string? FailureReason, DateTime ComputedAt, int Sequence);
