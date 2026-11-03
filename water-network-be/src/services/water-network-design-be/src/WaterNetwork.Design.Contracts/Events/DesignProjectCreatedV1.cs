namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.project.created</c>.</summary>
public sealed record DesignProjectCreatedV1(
    string ProjectId,
    string TenantId,
    string Name,
    string? BranchId,
    string? ZoneId);
