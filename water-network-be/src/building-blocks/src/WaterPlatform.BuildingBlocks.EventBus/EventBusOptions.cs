namespace WaterPlatform.BuildingBlocks.EventBus;

public sealed class EventBusOptions
{
    public const string SectionName = "EventBus";
    public string Producer { get; set; } = "unknown-service";
    public string Transport { get; set; } = "RabbitMq"; // RabbitMq | InMemory
}
