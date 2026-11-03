using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Caching;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence.Sql;

namespace WaterPlatform.BuildingBlocks.Infrastructure;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformPersistence<TContext>(
        this IServiceCollection services,
        IConfiguration configuration,
        Action<Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure.NpgsqlDbContextOptionsBuilder>? npgsql = null)
        where TContext : PlatformDbContext
    {
        var connectionString = configuration.GetConnectionString("PostgreSQL")
            ?? throw new InvalidOperationException("ConnectionStrings:PostgreSQL is required.");

        services.AddDbContext<TContext>(options =>
            options.UseNpgsql(connectionString, o =>
            {
                o.MigrationsAssembly(typeof(TContext).Assembly.GetName().Name ?? typeof(TContext).Assembly.FullName);
                npgsql?.Invoke(o);
            }));
        services.AddScoped<PlatformDbContext>(sp => sp.GetRequiredService<TContext>());

        services.AddScoped<IUnitOfWork, UnitOfWork>();
        // IIdempotencyService lives in Application.Commands; implementation is in Infrastructure.Persistence
        services.AddScoped<IIdempotencyService, IdempotencyService>();
        services.AddScoped<IInboxMessageStore, InboxMessageStore>();
        services.AddScoped<IProcessedEventStore, ProcessedEventStore>();
        services.AddScoped<IDomainEventDispatcher, DomainEventDispatcher>();
        // SqlReadDao uses IConfiguration + its own NpgsqlConnection — safe as scoped.
        services.AddScoped<IReadDao, SqlReadDao>();
        return services;
    }

    public static IServiceCollection AddPlatformOutbox(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<OutboxOptions>(opts =>
            configuration.GetSection(OutboxOptions.SectionName).Bind(opts));
        services.AddScoped<IOutboxRepository, OutboxRepository>();
        services.AddSingleton<IOutboxProcessor>(sp =>
        {
            var scopeFactory = sp.GetRequiredService<IServiceScopeFactory>();
            var logger = sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<OutboxProcessor>>();
            var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<OutboxOptions>>();
            return new OutboxProcessor(scopeFactory, logger, options);
        });
        services.AddHostedService(sp => (OutboxProcessor)sp.GetRequiredService<IOutboxProcessor>());
        return services;
    }

    public static IServiceCollection AddPlatformRedisCache(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Redis");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            services.AddDistributedMemoryCache();
        }
        else
        {
            services.AddStackExchangeRedisCache(options =>
            {
                options.Configuration = connectionString;
                options.InstanceName = configuration["Redis:InstanceName"] ?? "WaterPlatform:";
            });
        }
        services.AddSingleton<ICacheService, RedisCacheService>();
        return services;
    }

    /// <summary>
    /// Registers explicit domain event CLR types into the <see cref="IDomainEventTypeResolver"/>
    /// so that <see cref="OutboxProcessor"/> can reconstruct concrete events from the outbox payload.
    /// </summary>
    /// <remarks>
    /// Multiple calls accumulate into a single <see cref="IDomainEventTypeResolver"/> singleton.
    /// Each type is keyed by <c>Type.Name</c> — this must equal the <c>eventType</c> string
    /// stored in the outbox (the convention enforced by
    /// <see cref="WaterPlatform.BuildingBlocks.Domain.Events.DomainEventBase{TData}"/>).
    /// Duplicate registrations for the same key with an identical CLR type are silently ignored.
    /// </remarks>
    public static IServiceCollection AddOutboxDomainEventTypes(
        this IServiceCollection services,
        params Type[] eventTypes)
    {
        foreach (var type in eventTypes)
        {
            services.AddSingleton(new DomainEventTypeDescriptor(type.Name, type));
        }

        EnsureDomainEventTypeRegistry(services);
        return services;
    }

    /// <summary>
    /// Scans <paramref name="assembly"/> for non-abstract classes/records that implement
    /// <see cref="IDomainEvent"/> and registers each by <c>Type.Name</c> into the
    /// <see cref="IDomainEventTypeResolver"/> singleton.
    /// </summary>
    /// <remarks>
    /// The <c>eventType</c> string stored in the outbox must equal the concrete record's
    /// <c>Type.Name</c> — for example, <c>NodeDeleted</c> stores <c>EventType = "NodeDeleted"</c>.
    /// Services MUST call this method (or <see cref="AddOutboxDomainEventTypes"/>) so that the
    /// <see cref="OutboxProcessor"/> can deserialize and reconstruct concrete events.
    /// Multiple calls (potentially from different assemblies) accumulate into one resolver.
    /// </remarks>
    public static IServiceCollection AddOutboxDomainEventTypesFromAssembly(
        this IServiceCollection services,
        Assembly assembly)
    {
        var eventTypes = assembly.GetTypes()
            .Where(t => !t.IsAbstract && typeof(IDomainEvent).IsAssignableFrom(t));

        foreach (var type in eventTypes)
        {
            services.AddSingleton(new DomainEventTypeDescriptor(type.Name, type));
        }

        EnsureDomainEventTypeRegistry(services);
        return services;
    }

    private static void EnsureDomainEventTypeRegistry(IServiceCollection services)
    {
        // Only register the factory once; it reads all DomainEventTypeDescriptor singletons
        // at first resolution so subsequent AddOutboxDomainEventTypes* calls still accumulate.
        if (services.Any(s => s.ServiceType == typeof(IDomainEventTypeResolver)))
        {
            return;
        }

        services.AddSingleton<IDomainEventTypeResolver>(sp =>
        {
            var descriptors = sp.GetServices<DomainEventTypeDescriptor>();
            var map = new Dictionary<string, Type>(StringComparer.Ordinal);
            foreach (var d in descriptors)
            {
                map[d.EventType] = d.ClrType;
            }
            return new DomainEventTypeRegistry(map);
        });
    }
}
