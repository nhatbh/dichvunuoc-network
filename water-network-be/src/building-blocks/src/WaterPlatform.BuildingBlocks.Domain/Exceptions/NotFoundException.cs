namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class NotFoundException : BaseException
{
    private NotFoundException(string code, string message)
        : base(code, message) { }

    public static NotFoundException Resource(string resourceType, string? resourceId = null)
        => resourceId is null
            ? new NotFoundException("NOT_FOUND", $"Resource '{resourceType}' not found.")
            : new NotFoundException("NOT_FOUND", $"Resource '{resourceType}' with ID '{resourceId}' not found.");

    public static NotFoundException Entity(string entityName, string entityId)
        => new("NOT_FOUND", $"Entity '{entityName}' with ID '{entityId}' not found.");
}
