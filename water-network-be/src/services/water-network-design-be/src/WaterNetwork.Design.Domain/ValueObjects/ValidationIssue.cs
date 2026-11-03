namespace WaterNetwork.Design.Domain.ValueObjects;

/// <summary>Machine-readable validation finding. Severity is implied by the list it lives in
/// (ValidationResult.Errors vs .Warnings).</summary>
public sealed record ValidationIssue(
    string Code,
    string? DraftAssetId,
    string? ClientRef,
    string? Field,
    string Message);
