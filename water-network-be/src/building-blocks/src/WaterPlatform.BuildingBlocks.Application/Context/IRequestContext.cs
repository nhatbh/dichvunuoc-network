namespace WaterPlatform.BuildingBlocks.Application.Context;

public sealed record RequestContext(
    string CorrelationId,
    string? CausationId = null,
    string? UserId = null,
    string? TenantId = null
)
{
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;
    public Dictionary<string, object> Metadata { get; init; } = new();
}
