namespace WaterPlatform.BuildingBlocks.Application.Context;

public interface IRequestContextProvider
{
    RequestContext? Current();
    T Run<T>(RequestContext context, Func<T> callback);
    Task RunAsync(RequestContext context, Func<Task> callback);
    RequestContext Create(string? correlationId = null, string? userId = null);
}
