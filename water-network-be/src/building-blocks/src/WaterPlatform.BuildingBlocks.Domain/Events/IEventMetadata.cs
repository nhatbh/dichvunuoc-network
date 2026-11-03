namespace WaterPlatform.BuildingBlocks.Domain.Events;

public interface IEventMetadata
{
    string? UserId { get; }
    string? CorrelationId { get; }
    string? CausationId { get; }
    Dictionary<string, object> Extra { get; }
}

public sealed record EventMetadata(
    string? UserId = null,
    string? CorrelationId = null,
    string? CausationId = null
) : IEventMetadata
{
    public Dictionary<string, object> Extra { get; } = new();
}
