using System.Reflection;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace WaterPlatform.BuildingBlocks.WebApi.Endpoints;

/// <summary>
/// Discovers <see cref="IEndpointModule"/> implementations in an assembly and
/// maps their endpoints onto the route builder.
/// <para>
/// Modules are resolved in two passes:
/// <list type="number">
///   <item>DI: if a module type is registered in the supplied
///         <see cref="IServiceProvider"/>, that instance is used.</item>
///   <item>Fallback: otherwise the type must expose a public parameterless
///         constructor and is instantiated with <see cref="Activator"/>.</item>
/// </list>
/// This allows simple, stateless modules to omit DI boilerplate while
/// permitting stateful modules to take constructor dependencies.
/// </para>
/// </summary>
public static class EndpointModuleExtensions
{
    public static IEndpointRouteBuilder MapEndpointModules(
        this IEndpointRouteBuilder app,
        IServiceProvider services,
        Assembly assembly)
    {
        var moduleTypes = assembly.GetTypes()
            .Where(t => t is { IsAbstract: false, IsInterface: false }
                        && typeof(IEndpointModule).IsAssignableFrom(t));

        foreach (var type in moduleTypes)
        {
            IEndpointModule? module = null;

            // Prefer DI registration; supports singleton/scoped/transient
            // modules with constructor dependencies.
            try
            {
                module = (IEndpointModule?)services.GetService(type);
            }
            catch (InvalidOperationException)
            {
                // Multi-registration or unresolvable constructor — fall through
                // to parameterless activation below.
            }

            // Fallback: parameterless ctor for stateless modules.
            module ??= (IEndpointModule)Activator.CreateInstance(type)!;

            module.MapEndpoints(app);
        }

        return app;
    }
}
