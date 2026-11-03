namespace WaterNetwork.Design.Application.Dtos;

public sealed record ValidationIssueDto(string Code, string? DraftAssetId, string? ClientRef, string? Field, string Message);

public sealed record ValidationResultDto(
    bool IsValid,
    IReadOnlyList<ValidationIssueDto> Errors,
    IReadOnlyList<ValidationIssueDto> Warnings);
