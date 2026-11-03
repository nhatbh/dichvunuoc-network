namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class ConflictException : BaseException
{
    private ConflictException(string code, string message, object? details = null)
        : base(code, message, details) { }

    public static ConflictException Duplicate(string resourceType, string? field = null, string? value = null)
        => new("CONFLICT", field is null
            ? $"A '{resourceType}' with the given data already exists."
            : $"A '{resourceType}' with {field} '{value}' already exists.");

    public static ConflictException InvalidState(string resourceType, string currentState, string? requiredState = null)
        => new("INVALID_STATE", requiredState is null
            ? $"Resource '{resourceType}' is in an invalid state '{currentState}' for this operation."
            : $"Resource '{resourceType}' must be in state '{requiredState}' but is in '{currentState}'.");

    public static ConflictException VersionConflict(string resourceType, string resourceId, int expectedVersion, int actualVersion)
        => new("VERSION_CONFLICT", $"Version conflict for '{resourceType}' '{resourceId}': expected {expectedVersion}, actual {actualVersion}.");
}
