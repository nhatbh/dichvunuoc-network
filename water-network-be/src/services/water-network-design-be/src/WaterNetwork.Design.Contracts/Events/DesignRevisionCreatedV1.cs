namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.created</c>.</summary>
public sealed record DesignRevisionCreatedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber);
