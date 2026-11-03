using Microsoft.EntityFrameworkCore.Storage;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

internal sealed class TransactionContext : ITransactionContext
{
    private readonly IDbContextTransaction _transaction;

    public string TransactionId { get; }
    public bool IsActive => _transaction.TransactionId != Guid.Empty;

    public TransactionContext(IDbContextTransaction transaction)
    {
        _transaction = transaction;
        TransactionId = transaction.TransactionId.ToString();
    }
}
