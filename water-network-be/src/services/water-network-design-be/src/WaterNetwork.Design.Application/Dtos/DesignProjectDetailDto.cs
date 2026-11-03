namespace WaterNetwork.Design.Application.Dtos;

public sealed record DesignProjectDetailDto(
    string Id,
    string TenantId,
    string Name,
    string? BranchId,
    string? ZoneId,
    string Status,
    DateTime CreatedAt,
    DateTime UpdatedAt);
