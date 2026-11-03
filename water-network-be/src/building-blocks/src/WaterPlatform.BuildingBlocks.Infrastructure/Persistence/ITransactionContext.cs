namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public interface ITransactionContext
{
    string TransactionId { get; }
    bool IsActive { get; }
}
