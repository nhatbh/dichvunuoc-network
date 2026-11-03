using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;

namespace WaterPlatform.BuildingBlocks.Security;

/// <summary>
/// Extension methods for registering platform authentication and authorisation services.
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers JWT Bearer authentication and authorisation services.
    /// When <see cref="JwtOptions.Mode"/> is <c>Mock</c> a local symmetric key is used.
    /// Changing <see cref="JwtOptions.Mode"/> to <c>Authority</c> in configuration (no code change)
    /// switches to real Keycloak OIDC discovery.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Application configuration.</param>
    /// <param name="environment">
    /// Optional host environment. When provided, a <c>Mock</c> mode JWT configuration will cause a
    /// startup exception if the environment is Production.
    /// </param>
    public static IServiceCollection AddPlatformAuthentication(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment? environment = null)
    {
        // Idiomatic binding — one call, no manual Bind loop.
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));

        // Keep a local snapshot for branch decisions below.
        var options = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
        var allowedAuthorizedParties = (options.AllowedAuthorizedParties ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToHashSet(StringComparer.Ordinal);

        var isAuthorityMode = string.Equals(options.Mode, "Authority", StringComparison.OrdinalIgnoreCase);

        // Guard: Mock mode must never reach Production.
        if (!isAuthorityMode && environment?.IsProduction() == true)
        {
            throw new InvalidOperationException(
                "Jwt:Mode=Mock must not be used in Production. Set Jwt:Mode=Authority.");
        }

        // Guard: Authority mode requires a non-empty Authority URL.
        if (isAuthorityMode && string.IsNullOrWhiteSpace(options.Authority))
        {
            throw new InvalidOperationException(
                "Jwt:Mode is set to 'Authority' but Jwt:Authority is null or empty. " +
                "Provide the Keycloak realm URL in configuration (e.g. https://keycloak/realms/water-platform).");
        }

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(jwt =>
            {
                if (isAuthorityMode)
                {
                    // Real Keycloak — enabled later purely by config change.
                    jwt.Authority = options.Authority;
                    jwt.Audience = options.Audience;
                }
                else
                {
                    jwt.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidIssuer = options.Issuer,
                        ValidAudience = options.Audience,
                        IssuerSigningKey = new SymmetricSecurityKey(
                            Encoding.UTF8.GetBytes(options.MockSigningKey)),
                        ValidateIssuerSigningKey = true
                    };
                }

                if (allowedAuthorizedParties.Count > 0)
                {
                    jwt.Events = new JwtBearerEvents
                    {
                        OnTokenValidated = context =>
                        {
                            var authorizedParties = context.Principal?
                                .FindAll("azp")
                                .Select(claim => claim.Value)
                                .ToArray() ?? [];

                            if (authorizedParties.Length != 1
                                || !allowedAuthorizedParties.Contains(authorizedParties[0]))
                            {
                                context.Fail(
                                    "The access token must contain exactly one allowed 'azp' claim.");
                            }

                            return Task.CompletedTask;
                        }
                    };
                }
            });

        services.AddAuthorization();
        return services;
    }

    /// <summary>
    /// Requires that the authenticated user holds the specified <paramref name="permission"/> claim
    /// (format <c>"&lt;context&gt;:&lt;action&gt;"</c>, e.g. <c>"network-gis:write"</c>).
    /// </summary>
    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, string permission)
        where TBuilder : IEndpointConventionBuilder
        => builder.RequireAuthorization(policy => policy.RequireClaim("permission", permission));
}
