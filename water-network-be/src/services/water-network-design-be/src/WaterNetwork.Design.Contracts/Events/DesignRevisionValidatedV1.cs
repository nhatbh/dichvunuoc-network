namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.validated</c>.</summary>
public sealed record DesignRevisionValidatedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int ErrorCount,
    int WarningCount,
    bool IsValid);
