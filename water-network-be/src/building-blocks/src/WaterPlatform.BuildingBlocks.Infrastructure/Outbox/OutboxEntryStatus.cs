namespace WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

public enum OutboxEntryStatus
{
    Pending,
    Processing,
    Processed,
    Failed
}
