namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.submitted</c>.</summary>
public sealed record DesignRevisionSubmittedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId);
