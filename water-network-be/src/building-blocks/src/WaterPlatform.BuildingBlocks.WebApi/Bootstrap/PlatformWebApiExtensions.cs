using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Context;
using WaterPlatform.BuildingBlocks.WebApi.Http;

namespace WaterPlatform.BuildingBlocks.WebApi.Bootstrap;

public static class PlatformWebApiExtensions
{
    public static WebApplicationBuilder AddPlatformWebApi(this WebApplicationBuilder builder)
    {
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddSingleton<IRequestContextProvider, RequestContextProvider>();
        builder.Services.AddOpenApi();
        builder.Services.AddProblemDetails();
        builder.Services.Configure<JsonOptions>(o =>
            o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
        builder.Services.AddPlatformMultiTenancy(builder.Configuration, builder.Environment);
        builder.Services.AddPlatformAuthentication(builder.Configuration, builder.Environment);
        return builder;
    }

    public static WebApplication UsePlatformWebApi(this WebApplication app)
    {
        app.UseMiddleware<GlobalExceptionMiddleware>();
        app.UseMiddleware<CorrelationIdMiddleware>();
        app.UseAuthentication();
        app.UsePlatformMultiTenancy();
        app.UseAuthorization();
        app.MapOpenApi();
        return app;
    }
}
