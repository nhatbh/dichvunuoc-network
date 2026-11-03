using MassTransit;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.EventBus;

public static class MassTransitConfiguration
{
    public static IServiceCollection AddPlatformEventBus(
        this IServiceCollection services,
        IConfiguration configuration,
        Action<IBusRegistrationConfigurator>? configureConsumers = null)
    {
        services.Configure<EventBusOptions>(opts => configuration.GetSection(EventBusOptions.SectionName).Bind(opts));
        services.AddScoped<IIntegrationEventPublisher, MassTransitIntegrationEventPublisher>();

        // Fallback mapper: wraps any domain event as a serialized payload.
        // OutboxProcessor picks mappers with LastOrDefault(CanMap), so service-specific mappers
        // registered AFTER this one (i.e. later AddSingleton calls) take precedence over this fallback.
        services.AddSingleton<IIntegrationEventMapper, SerializedDomainEventIntegrationEventMapper>();

        var transport = configuration[$"{EventBusOptions.SectionName}:Transport"] ?? "RabbitMq";

        services.AddMassTransit(bus =>
        {
            bus.SetKebabCaseEndpointNameFormatter();

            configureConsumers?.Invoke(bus);

            if (string.Equals(transport, "InMemory", StringComparison.OrdinalIgnoreCase))
            {
                bus.UsingInMemory((context, cfg) =>
                {
                    cfg.UseMessageRetry(r => r.Immediate(3));
                    cfg.ConfigureEndpoints(context);
                });
            }
            else
            {
                bus.UsingRabbitMq((context, cfg) =>
                {
                    var rabbitHost = configuration["MassTransit:RabbitMq:Host"] ?? "localhost";
                    var rabbitVHost = configuration["MassTransit:RabbitMq:VirtualHost"] ?? "/";
                    var portRaw = configuration["MassTransit:RabbitMq:Port"];
                    Action<IRabbitMqHostConfigurator> hostCfg = h =>
                    {
                        h.Username(configuration["MassTransit:RabbitMq:Username"] ?? "guest");
                        h.Password(configuration["MassTransit:RabbitMq:Password"] ?? "guest");
                    };
                    // Port is optional: integration tests (Testcontainers) map RabbitMQ to a random
                    // host port and supply it here; production omits it and uses the default 5672.
                    // 0 is not a valid AMQP port, so treat it as "unset" rather than passing it through.
                    if (ushort.TryParse(portRaw, out var rabbitPort) && rabbitPort > 0)
                        cfg.Host(rabbitHost, rabbitPort, rabbitVHost, hostCfg);
                    else
                        cfg.Host(rabbitHost, rabbitVHost, hostCfg);
                    cfg.UseMessageRetry(r => r.Immediate(3));
                    cfg.ConfigureEndpoints(context);
                });
            }
        });

        return services;
    }
}
