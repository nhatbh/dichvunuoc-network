using WaterPlatform.BuildingBlocks.Application.Context;

namespace WaterPlatform.BuildingBlocks.WebApi.Context;

public sealed class RequestContextProvider : IRequestContextProvider
{
    private static readonly AsyncLocal<RequestContext?> AsyncLocalContext = new();

    public RequestContext? Current() => AsyncLocalContext.Value;

    public T Run<T>(RequestContext context, Func<T> callback)
    {
        var previous = AsyncLocalContext.Value;
        AsyncLocalContext.Value = context;
        try
        {
            return callback();
        }
        finally
        {
            AsyncLocalContext.Value = previous;
        }
    }

    public async Task RunAsync(RequestContext context, Func<Task> callback)
    {
        var previous = AsyncLocalContext.Value;
        AsyncLocalContext.Value = context;
        try
        {
            await callback();
        }
        finally
        {
            AsyncLocalContext.Value = previous;
        }
    }

    public RequestContext Create(string? correlationId = null, string? userId = null)
        => new(
            CorrelationId: correlationId ?? Guid.NewGuid().ToString(),
            UserId: userId
        );
}
