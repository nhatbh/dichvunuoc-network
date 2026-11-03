namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class ForbiddenException : BaseException
{
    private ForbiddenException(string message, object? details = null)
        : base("FORBIDDEN", message, details) { }

    public static ForbiddenException InsufficientPermissions(string? requiredPermission = null, string? userId = null)
        => new(requiredPermission is null
            ? "Insufficient permissions."
            : $"Insufficient permissions. Required: {requiredPermission}.");

    public static ForbiddenException InsufficientRole(string requiredRole, string? userRole = null)
        => new($"Insufficient role. Required: {requiredRole}{(userRole is not null ? $", Current: {userRole}" : "")}.");

    public static ForbiddenException ResourceAccessDenied(string resourceType, string? resourceId = null, string? userId = null)
        => new($"Access denied to resource '{resourceType}'{(resourceId is not null ? $" with ID '{resourceId}'" : "")}.");
}
