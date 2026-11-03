using System.Globalization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;

namespace WaterPlatform.BuildingBlocks.Observability;

public static class ServiceCollectionExtensions
{
    // 0 = no install attempt yet; 1 = first call already installed the static.
    // Interlocked.CompareExchange makes AddObservability safe to call multiple
    // times (e.g. integration tests / multiple WebApplicationBuilders) — only
    // the first call mutates the global Log.Logger; subsequent calls still
    // call services.AddSerilog(), which is itself idempotent in DI.
    private static int _staticLoggerInstalled;

    public static IServiceCollection AddObservability(this IServiceCollection services, IConfiguration configuration)
    {
        var serviceName = configuration["ServiceName"] ?? "WaterPlatform";
        var serviceVersion = configuration["ServiceVersion"] ?? "1.0.0";
        var enablePrometheus = configuration.GetValue<bool>("OpenTelemetry:EnablePrometheus");
        var otlpEndpoint = ResolveOtlpEndpoint(configuration);

        if (Interlocked.CompareExchange(ref _staticLoggerInstalled, 1, 0) == 0)
        {
            Log.Logger = new LoggerConfiguration()
                .ReadFrom.Configuration(configuration)
                .Enrich.FromLogContext()
                .Enrich.WithProperty("ServiceName", serviceName)
                .Enrich.WithProperty("ServiceVersion", serviceVersion)
                .WriteTo.Console(formatProvider: CultureInfo.InvariantCulture)
                .CreateLogger();
        }

        services.AddSerilog();

        services.AddOpenTelemetry()
            .ConfigureResource(resource => resource
                .AddService(serviceName: serviceName, serviceVersion: serviceVersion))
            .WithTracing(tracing => tracing
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddEntityFrameworkCoreInstrumentation()
                .AddOtlpExporter(options => options.Endpoint = new Uri(otlpEndpoint)))
            .WithMetrics(metrics =>
            {
                metrics
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddOtlpExporter(options => options.Endpoint = new Uri(otlpEndpoint));

                if (enablePrometheus)
                {
                    metrics.AddPrometheusExporter();
                }
            });

        return services;
    }

    /// <summary>
    /// Returns the OTLP endpoint from configuration, falling back to the
    /// local collector default. Treats null and whitespace as "unset" so an
    /// empty configuration value does not produce a bogus URI.
    /// </summary>
    private static string ResolveOtlpEndpoint(IConfiguration configuration)
    {
        var configured = configuration["OpenTelemetry:OtlpEndpoint"];
        return string.IsNullOrWhiteSpace(configured)
            ? "http://localhost:4317"
            : configured;
    }
}
