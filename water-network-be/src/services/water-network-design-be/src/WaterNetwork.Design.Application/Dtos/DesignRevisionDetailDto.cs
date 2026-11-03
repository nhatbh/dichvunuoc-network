namespace WaterNetwork.Design.Application.Dtos;

public sealed record DesignRevisionDetailDto(
    string Id,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string Status,
    ValidationResultDto? ValidationResult,
    IReadOnlyList<RevisionTransitionDto> Transitions);
