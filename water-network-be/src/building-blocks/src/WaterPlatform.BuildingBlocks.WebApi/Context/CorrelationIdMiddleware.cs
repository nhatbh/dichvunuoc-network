using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Application.Context;

namespace WaterPlatform.BuildingBlocks.WebApi.Context;

public sealed class CorrelationIdMiddleware(
    RequestDelegate continuation,
    IRequestContextProvider requestContextProvider,
    ILogger<CorrelationIdMiddleware> logger)
{
    private const string CorrelationIdHeader = "x-correlation-id";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers.TryGetValue(CorrelationIdHeader, out var value)
            ? value.FirstOrDefault()
            : Guid.NewGuid().ToString();

        if (string.IsNullOrWhiteSpace(correlationId))
        {
            correlationId = Guid.NewGuid().ToString();
        }

        var userId = context.User.Identity?.IsAuthenticated == true
            ? context.User.FindFirst("sub")?.Value ?? context.User.FindFirst("nameidentifier")?.Value
            : null;

        var requestContext = requestContextProvider.Create(correlationId, userId);
        context.Items["RequestContext"] = requestContext;
        context.Response.Headers.Append(CorrelationIdHeader, correlationId);

        using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
        {
            await requestContextProvider.RunAsync(requestContext, () => continuation(context));
        }
    }
}
