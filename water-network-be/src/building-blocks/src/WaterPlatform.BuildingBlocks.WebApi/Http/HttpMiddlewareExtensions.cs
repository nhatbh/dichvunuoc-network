using Microsoft.AspNetCore.Builder;
using WaterPlatform.BuildingBlocks.WebApi.Context;

namespace WaterPlatform.BuildingBlocks.WebApi.Http;

public static class HttpMiddlewareExtensions
{
    public static IApplicationBuilder UseCorrelationId(this IApplicationBuilder app)
        => app.UseMiddleware<CorrelationIdMiddleware>();

    public static IApplicationBuilder UseGlobalExceptionHandler(this IApplicationBuilder app)
        => app.UseMiddleware<GlobalExceptionMiddleware>();
}
