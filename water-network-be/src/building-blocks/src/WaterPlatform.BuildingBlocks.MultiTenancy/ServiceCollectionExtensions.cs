using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformMultiTenancy(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment? environment = null)
    {
        var tenantOptions = services.AddOptions<TenantOptions>()
            .Bind(configuration.GetSection(TenantOptions.SectionName))
            .Validate(
                options => !string.IsNullOrWhiteSpace(options.TenantClaim)
                    && !string.IsNullOrWhiteSpace(options.OrganizationClaim)
                    && !string.IsNullOrWhiteSpace(options.OrganizationTenantIdAttribute)
                    && !string.IsNullOrWhiteSpace(options.BranchClaim)
                    && !string.IsNullOrWhiteSpace(options.TenantHeader),
                "MultiTenancy claim, attribute, and header names must not be empty.")
            .ValidateOnStart();

        if (environment?.IsProduction() == true)
        {
            tenantOptions.Validate(
                options => !options.AllowHeaderFallback,
                "MultiTenancy:AllowHeaderFallback must be false in Production.")
                .ValidateOnStart();
        }

        services.AddSingleton<TenantContextAccessor>();
        services.AddSingleton<ITenantContextAccessor>(sp => sp.GetRequiredService<TenantContextAccessor>());
        return services;
    }

    /// <summary>
    /// Adds the <see cref="TenantResolutionMiddleware"/> to the application pipeline.
    /// </summary>
    /// <remarks>
    /// Must be registered AFTER <c>UseAuthentication</c> in the pipeline; otherwise the
    /// authenticated user's claims are not yet populated and tenant resolution from claims
    /// will not work.
    /// </remarks>
    public static IApplicationBuilder UsePlatformMultiTenancy(this IApplicationBuilder app)
        => app.UseMiddleware<TenantResolutionMiddleware>();
}
