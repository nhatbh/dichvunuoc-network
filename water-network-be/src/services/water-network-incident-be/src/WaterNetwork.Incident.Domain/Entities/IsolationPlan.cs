using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Domain.Entities;

/// <summary>Immutable snapshot of a topology isolation computation for an incident
/// (decision 0023). Re-analysis supersedes the prior Proposed plan; plans are never
/// edited in place.</summary>
public sealed record IsolationPlan
{
    public string Id { get; init; }
    public IsolationPlanStatus Status { get; init; }
    public string StartNodeId { get; init; }
    public long GraphVersion { get; init; }
    public IReadOnlyList<string> ValvesToClose { get; init; }
    public IReadOnlyList<string> IsolatedNodes { get; init; }
    public IReadOnlyList<string> IsolatedPipes { get; init; }
    public string? FailureReason { get; init; }
    public DateTime ComputedAt { get; init; }
    public int Sequence { get; init; }

    private IsolationPlan(
        string id, IsolationPlanStatus status, string startNodeId, long graphVersion,
        IReadOnlyList<string> valvesToClose, IReadOnlyList<string> isolatedNodes,
        IReadOnlyList<string> isolatedPipes, string? failureReason, DateTime computedAt, int sequence)
    {
        Id = id;
        Status = status;
        StartNodeId = startNodeId;
        GraphVersion = graphVersion;
        ValvesToClose = valvesToClose;
        IsolatedNodes = isolatedNodes;
        IsolatedPipes = isolatedPipes;
        FailureReason = failureReason;
        ComputedAt = computedAt;
        Sequence = sequence;
    }

    public static IsolationPlan Proposed(
        string incidentId, string startNodeId, long graphVersion,
        IReadOnlyList<string> valvesToClose, IReadOnlyList<string> isolatedNodes,
        IReadOnlyList<string> isolatedPipes, int sequence)
        => new(Guid.CreateVersion7().ToString(), IsolationPlanStatus.Proposed, startNodeId, graphVersion,
            valvesToClose, isolatedNodes, isolatedPipes, failureReason: null, DateTime.UtcNow, sequence);

    public static IsolationPlan Failed(string incidentId, string startNodeId, string reason, int sequence)
        => new(Guid.CreateVersion7().ToString(), IsolationPlanStatus.AnalysisFailed, startNodeId, graphVersion: 0,
            [], [], [], reason, DateTime.UtcNow, sequence);

    public IsolationPlan AsSuperseded()
    {
        if (Status != IsolationPlanStatus.Proposed)
            throw new InvalidOperationException($"Only a Proposed plan can be superseded; current status is {Status}.");
        return this with { Status = IsolationPlanStatus.Superseded };
    }

    public IsolationPlan AsConfirmed()
    {
        if (Status != IsolationPlanStatus.Proposed)
            throw new InvalidOperationException($"Only a Proposed plan can be confirmed; current status is {Status}.");
        return this with { Status = IsolationPlanStatus.Confirmed };
    }

    /// <summary>Rehydrate from persistence (no validation; trusted store).</summary>
    public static IsolationPlan Reconstitute(
        string id, IsolationPlanStatus status, string startNodeId, long graphVersion,
        IReadOnlyList<string> valvesToClose, IReadOnlyList<string> isolatedNodes,
        IReadOnlyList<string> isolatedPipes, string? failureReason, DateTime computedAt, int sequence)
        => new(id, status, startNodeId, graphVersion, valvesToClose, isolatedNodes, isolatedPipes,
            failureReason, computedAt, sequence);
}
