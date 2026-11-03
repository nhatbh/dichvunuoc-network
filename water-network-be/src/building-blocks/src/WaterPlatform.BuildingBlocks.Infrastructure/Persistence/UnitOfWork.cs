using Microsoft.EntityFrameworkCore;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

internal sealed class UnitOfWork(PlatformDbContext dbContext) : IUnitOfWork
{
    public async Task<TResult> ExecuteInTransactionAsync<TResult>(Func<ITransactionContext, Task<TResult>> work, CancellationToken ct = default)
    {
        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(ct);
            var context = new TransactionContext(transaction);

            try
            {
                var result = await work(context);
                await dbContext.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return result;
            }
            catch
            {
                await transaction.RollbackAsync(ct);
                throw;
            }
        });
    }

    public async Task ExecuteInTransactionAsync(Func<ITransactionContext, Task> work, CancellationToken ct = default)
    {
        await ExecuteInTransactionAsync(async ctx =>
        {
            await work(ctx);
            return true;
        }, ct);
    }
}
