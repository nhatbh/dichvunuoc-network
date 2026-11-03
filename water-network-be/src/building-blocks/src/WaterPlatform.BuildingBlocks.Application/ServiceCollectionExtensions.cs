using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Application.Cqrs.Behaviors;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterPlatform.BuildingBlocks.Application;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformCqrs(this IServiceCollection services)
    {
        services.TryAddScoped<ICommandBus, CommandBus>();
        services.TryAddScoped<IQueryBus, QueryBus>();
        return services;
    }

    public static IServiceCollection AddPlatformCqrsBehaviors(this IServiceCollection services)
    {
        // TryAddEnumerable prevents duplicate registrations when called more than once.
        services.TryAddEnumerable(ServiceDescriptor.Scoped<ICommandPipelineBehavior, LoggingCommandBehavior>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<ICommandPipelineBehavior, IdempotencyCommandBehavior>());
        return services;
    }

    public static IServiceCollection AddHandlersFromAssembly(this IServiceCollection services, Assembly assembly)
    {
        var handlerInterfaces = new[]
        {
            typeof(ICommandHandler<,>), typeof(IQueryHandler<,>), typeof(IDomainEventHandler<>)
        };

        IEnumerable<Type> types;
        try
        {
            types = assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException e)
        {
            types = e.Types.Where(t => t is not null)!;
        }

        foreach (var type in types.Where(t => t is { IsAbstract: false, IsInterface: false }))
        {
            foreach (var iface in type.GetInterfaces().Where(i =>
                i.IsGenericType && handlerInterfaces.Contains(i.GetGenericTypeDefinition())))
            {
                // TryAddEnumerable prevents duplicate (iface, type) registrations
                // when AddHandlersFromAssembly is called more than once for the same assembly.
                services.TryAddEnumerable(ServiceDescriptor.Scoped(iface, type));
            }
        }

        return services;
    }
}
