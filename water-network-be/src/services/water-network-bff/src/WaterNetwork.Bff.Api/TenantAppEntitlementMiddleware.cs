using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using WaterNetwork.Bff.Api.Configuration;
using WaterNetwork.Bff.Api.Http;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Bff.Api;

/// <summary>
/// Enforces the tenant-to-application entitlement before any Water Network downstream is called.
/// Authentication and endpoint permission policies still run independently; this gate adds the
/// missing Organization/tenant_apps decision and fails closed when app-catalog is unavailable.
/// </summary>
public sealed class TenantAppEntitlementMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(
        HttpContext context,
        ITenantContextAccessor tenantContextAccessor,
        ITenantAppEntitlementClient entitlementClient,
        IMemoryCache cache,
        IOptions<AppEntitlementOptions> options)
    {
        if (!IsProtectedPath(context.Request.Path) || context.User.Identity?.IsAuthenticated != true)
        {
            await next(context);
            return;
        }

        var tenantId = tenantContextAccessor.Current?.TenantId;
        var authorizedParties = context.User.FindAll("azp").Select(claim => claim.Value).ToArray();
        var subjects = context.User.FindAll("sub").Concat(context.User.FindAll(ClaimTypes.NameIdentifier))
            .Select(claim => claim.Value).Distinct(StringComparer.Ordinal).ToArray();
        if (string.IsNullOrWhiteSpace(tenantId)
            || authorizedParties.Length != 1
            || string.IsNullOrWhiteSpace(authorizedParties[0])
            || subjects.Length != 1 || string.IsNullOrWhiteSpace(subjects[0])
            || context.Request.Headers.Authorization.Count != 1
            || !AuthenticationHeaderValue.TryParse(context.Request.Headers.Authorization.ToString(), out var bearer)
            || !string.Equals(bearer.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(bearer.Parameter))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        var appCode = options.Value.AppCode;
        // Authentication has validated this bearer before the gate. /me is role-filtered,
        // so an allow for one actor/token must never authorize another actor or role set.
        // Keep only the fingerprint in memory, never the credential itself.
        var tokenFingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(bearer.Parameter)));
        var cacheKey = new EntitlementCacheKey(tenantId, appCode, authorizedParties[0], subjects[0], tokenFingerprint);
        if (!cache.TryGetValue(cacheKey, out TenantAppAccessStatus access))
        {
            access = await entitlementClient.CheckAccessAsync(appCode, context.RequestAborted);
            if (access is TenantAppAccessStatus.Allowed or TenantAppAccessStatus.Denied)
            {
                cache.Set(
                    cacheKey,
                    access,
                    TimeSpan.FromSeconds(options.Value.CacheTtlSeconds));
            }
        }

        if (access == TenantAppAccessStatus.Denied)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        if (access == TenantAppAccessStatus.Unavailable)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            return;
        }

        await next(context);
    }

    private static bool IsProtectedPath(PathString path) =>
        path.StartsWithSegments("/bff/water-network", StringComparison.Ordinal)
        || path.StartsWithSegments("/api/gis", StringComparison.Ordinal);

    private readonly record struct EntitlementCacheKey(
        string TenantId,
        string AppCode,
        string AuthorizedParty,
        string Subject,
        string TokenFingerprint);
}
