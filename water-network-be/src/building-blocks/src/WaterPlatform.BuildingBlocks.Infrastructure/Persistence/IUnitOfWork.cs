namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public interface IUnitOfWork
{
    Task<TResult> ExecuteInTransactionAsync<TResult>(Func<ITransactionContext, Task<TResult>> work, CancellationToken ct = default);
    Task ExecuteInTransactionAsync(Func<ITransactionContext, Task> work, CancellationToken ct = default);
}
