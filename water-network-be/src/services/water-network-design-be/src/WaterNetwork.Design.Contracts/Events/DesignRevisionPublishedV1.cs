namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.published</c> (terminal: Published or PartiallyPublished).</summary>
public sealed record DesignRevisionPublishedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string Status,                // "Published" | "PartiallyPublished"
    int ImportedCount,
    int FailedCount);
