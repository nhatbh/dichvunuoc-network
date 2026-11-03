namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.approved</c>.</summary>
public sealed record DesignRevisionApprovedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string? Reason);
