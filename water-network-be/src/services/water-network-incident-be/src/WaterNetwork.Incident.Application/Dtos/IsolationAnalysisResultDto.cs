namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IsolationAnalysisResultDto(
    string IncidentId,
    string PlanId,
    string Status,            // "Proposed" or "AnalysisFailed"
    string IncidentStatus,    // "IsolationPlanReady" or "IsolationRequested"
    string? FailureReason,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes);
