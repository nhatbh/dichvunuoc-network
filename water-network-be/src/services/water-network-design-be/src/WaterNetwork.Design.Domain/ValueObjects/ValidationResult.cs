namespace WaterNetwork.Design.Domain.ValueObjects;

public sealed record ValidationResult(
    IReadOnlyList<ValidationIssue> Errors,
    IReadOnlyList<ValidationIssue> Warnings)
{
    public bool HasErrors => Errors.Count > 0;

    public static ValidationResult Empty { get; } =
        new(Array.Empty<ValidationIssue>(), Array.Empty<ValidationIssue>());
}
