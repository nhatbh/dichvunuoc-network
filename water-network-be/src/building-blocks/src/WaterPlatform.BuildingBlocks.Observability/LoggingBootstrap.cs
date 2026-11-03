using Microsoft.AspNetCore.Builder;
using Serilog;

namespace WaterPlatform.BuildingBlocks.Observability;

public static class LoggingBootstrap
{
    public static WebApplicationBuilder AddSerilogLogging(this WebApplicationBuilder builder)
    {
        builder.Host.UseSerilog((context, config) =>
        {
            config.ReadFrom.Configuration(context.Configuration);
            config.Enrich.FromLogContext()
                  .Enrich.WithProperty("Application", "WaterPlatform");
        });

        return builder;
    }
}
