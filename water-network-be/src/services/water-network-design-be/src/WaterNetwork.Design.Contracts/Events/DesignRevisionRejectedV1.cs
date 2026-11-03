namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.rejected</c>.</summary>
public sealed record DesignRevisionRejectedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string Reason);
