using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace WaterPlatform.BuildingBlocks.Observability;

public static class HealthCheckBootstrap
{
    public static WebApplicationBuilder AddDefaultHealthChecks(this WebApplicationBuilder builder)
    {
        var healthChecks = builder.Services.AddHealthChecks();

        var postgreSqlConnectionString = builder.Configuration.GetConnectionString("PostgreSQL");
        if (!string.IsNullOrWhiteSpace(postgreSqlConnectionString))
        {
            healthChecks.AddNpgSql(postgreSqlConnectionString, name: "postgresql", failureStatus: HealthStatus.Unhealthy);
        }

        var redisConnectionString = builder.Configuration.GetConnectionString("Redis");
        if (!string.IsNullOrWhiteSpace(redisConnectionString))
        {
            healthChecks.AddRedis(redisConnectionString, name: "redis", failureStatus: HealthStatus.Unhealthy);
        }

        // RabbitMQ health check. AspNetCore.HealthChecks.Rabbitmq v9 exposes
        // a Func<IServiceProvider, Task<IConnection>> overload, so the connect
        // is awaited on the request thread (no sync-over-async on first probe).
        // Only register when:
        //   1. MassTransit:RabbitMq:Host is configured, AND
        //   2. RabbitMQ is the active EventBus transport (or EventBus:Transport
        //      is unset, which defaults to RabbitMQ).
        var rabbitMqHost = builder.Configuration["MassTransit:RabbitMq:Host"];
        var eventBusTransport = builder.Configuration["EventBus:Transport"] ?? "RabbitMq";
        var rabbitMqIsActiveTransport = string.IsNullOrWhiteSpace(eventBusTransport)
            || string.Equals(eventBusTransport, "RabbitMq", StringComparison.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(rabbitMqHost) && rabbitMqIsActiveTransport)
        {
            var factory = RecoveringRabbitMqConnection.CreateFactory(builder.Configuration);
            builder.Services.AddSingleton(_ => new RecoveringRabbitMqConnection(
                () => factory.CreateConnectionAsync()));
            healthChecks.AddRabbitMQ(
                sp => sp.GetRequiredService<RecoveringRabbitMqConnection>().GetAsync(),
                name: "rabbitmq",
                failureStatus: HealthStatus.Unhealthy);
        }

        return builder;
    }
}
