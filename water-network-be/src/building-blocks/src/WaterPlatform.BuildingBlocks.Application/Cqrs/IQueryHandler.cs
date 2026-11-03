using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

public interface IQueryHandler<in TQuery, TResult> where TQuery : IQuery<TResult>
{
    Task<TResult> HandleAsync(TQuery query, CancellationToken ct);
}
