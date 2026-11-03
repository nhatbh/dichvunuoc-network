namespace WaterPlatform.BuildingBlocks.Application.Queries;

public interface IQueryBus
{
    Task<TResult> ExecuteAsync<TResult>(IQuery<TResult> query, CancellationToken ct = default);
}
