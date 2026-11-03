using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

internal abstract class QueryHandlerWrapper<TResult>
{
    public abstract Task<TResult> Handle(IQuery<TResult> query, IServiceProvider sp, CancellationToken ct);
}

internal sealed class QueryHandlerWrapperImpl<TQuery, TResult> : QueryHandlerWrapper<TResult>
    where TQuery : IQuery<TResult>
{
    public override Task<TResult> Handle(IQuery<TResult> query, IServiceProvider sp, CancellationToken ct)
        => sp.GetRequiredService<IQueryHandler<TQuery, TResult>>().HandleAsync((TQuery)query, ct);
}

internal sealed class QueryBus(IServiceProvider serviceProvider) : IQueryBus
{
    // Cache is keyed by query Type whose IQuery<TResult> fixes TResult, so a process-global static cache is safe.
    private static readonly ConcurrentDictionary<Type, object> Wrappers = new();

    public Task<TResult> ExecuteAsync<TResult>(IQuery<TResult> query, CancellationToken ct = default)
    {
        var wrapper = (QueryHandlerWrapper<TResult>)Wrappers.GetOrAdd(query.GetType(), static queryType =>
            Activator.CreateInstance(
                typeof(QueryHandlerWrapperImpl<,>).MakeGenericType(queryType, typeof(TResult)))!);
        return wrapper.Handle(query, serviceProvider, ct);
    }
}
