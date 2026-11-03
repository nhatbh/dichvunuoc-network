using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using System.Security.Claims;
using System.Text.Json;

namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed class TenantResolutionMiddleware(RequestDelegate nextMiddleware, IOptions<TenantOptions> options)
{
    public async Task InvokeAsync(HttpContext httpContext, TenantContextAccessor accessor)
    {
        var opts = options.Value;
        accessor.SetContext(null);

        var resolution = ResolveSignedClaims(httpContext.User, opts);
        if (!resolution.IsValid)
        {
            httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var context = resolution.Context;

        if (context is null && opts.AllowHeaderFallback
            && httpContext.Request.Headers.TryGetValue(opts.TenantHeader, out StringValues headerValue))
        {
            var tenantId = headerValue.FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(tenantId))
                context = new TenantContext(tenantId);
        }

        accessor.SetContext(context);

        try
        {
            await nextMiddleware(httpContext);
        }
        finally
        {
            accessor.SetContext(null);
        }
    }

    private static TenantResolution ResolveSignedClaims(ClaimsPrincipal principal, TenantOptions options)
    {
        // Only claims attached to an authenticated identity are eligible. In the normal
        // pipeline UseAuthentication has already validated the JWT signature and issuer.
        var authenticatedClaims = principal.Identities
            .Where(identity => identity.IsAuthenticated)
            .SelectMany(identity => identity.Claims)
            .ToArray();
        var organizationClaims = authenticatedClaims
            .Where(claim => string.Equals(claim.Type, options.OrganizationClaim, StringComparison.Ordinal))
            .ToArray();
        var flatTenantClaims = authenticatedClaims
            .Where(claim => string.Equals(claim.Type, options.TenantClaim, StringComparison.Ordinal))
            .ToArray();
        var scopeClaims = authenticatedClaims
            .Where(claim => string.Equals(claim.Type, "scope", StringComparison.Ordinal))
            .ToArray();
        var branchId = authenticatedClaims
            .FirstOrDefault(claim => string.Equals(claim.Type, options.BranchClaim, StringComparison.Ordinal))
            ?.Value;

        if (organizationClaims.Length > 0)
        {
            if (organizationClaims.Length != 1
                || !TryReadSelectedOrganization(
                    organizationClaims[0].Value,
                    options.OrganizationTenantIdAttribute,
                    out var organizationTenantId,
                    out var organizationId,
                    out var organizationAlias)
                || !HasExactSelectedOrganizationScope(scopeClaims, organizationAlias))
            {
                return TenantResolution.Invalid;
            }

            if (!TryReadOptionalSingleClaim(flatTenantClaims, out var flatTenantId))
                return TenantResolution.Invalid;

            if (flatTenantId is not null
                && !string.Equals(flatTenantId, organizationTenantId, StringComparison.Ordinal))
            {
                return TenantResolution.Invalid;
            }

            return TenantResolution.Valid(new TenantContext(
                organizationTenantId,
                organizationId,
                branchId));
        }

        if (!TryReadOptionalSingleClaim(flatTenantClaims, out var legacyTenantId))
            return TenantResolution.Invalid;

        if (legacyTenantId is null)
            return TenantResolution.Valid(null);

        if (!options.AllowFlatTenantClaimCompatibility)
            return TenantResolution.Invalid;

        return TenantResolution.Valid(new TenantContext(
            legacyTenantId,
            null,
            branchId));
    }

    private static bool HasExactSelectedOrganizationScope(Claim[] scopeClaims, string organizationAlias)
    {
        if (scopeClaims.Length != 1 || string.IsNullOrWhiteSpace(scopeClaims[0].Value))
            return false;

        var organizationScopes = scopeClaims[0].Value
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(scope => string.Equals(scope, "organization", StringComparison.Ordinal)
                || scope.StartsWith("organization:", StringComparison.Ordinal))
            .ToArray();

        return organizationScopes.Length == 1
            && string.Equals(
                organizationScopes[0],
                $"organization:{organizationAlias}",
                StringComparison.Ordinal);
    }

    private static bool TryReadOptionalSingleClaim(Claim[] claims, out string? value)
    {
        value = null;
        if (claims.Length == 0)
            return true;

        if (claims.Length != 1 || string.IsNullOrWhiteSpace(claims[0].Value))
            return false;

        value = claims[0].Value;
        return true;
    }

    private static bool TryReadSelectedOrganization(
        string claimValue,
        string tenantIdAttribute,
        out string tenantId,
        out string? organizationId,
        out string organizationAlias)
    {
        tenantId = string.Empty;
        organizationId = null;
        organizationAlias = string.Empty;

        try
        {
            using var document = JsonDocument.Parse(claimValue);
            var root = document.RootElement;

            // Some JWT handlers expose JSON object claims directly while others preserve
            // the serialized JSON string. Accept one string wrapper, but no arbitrary nesting.
            JsonDocument? unwrappedDocument = null;
            try
            {
                if (root.ValueKind == JsonValueKind.String)
                {
                    var unwrapped = root.GetString();
                    if (string.IsNullOrWhiteSpace(unwrapped))
                        return false;

                    unwrappedDocument = JsonDocument.Parse(unwrapped);
                    root = unwrappedDocument.RootElement;
                }

                if (root.ValueKind != JsonValueKind.Object)
                    return false;

                var organizations = root.EnumerateObject().ToArray();
                if (organizations.Length != 1
                    || !IsValidOrganizationAlias(organizations[0].Name)
                    || organizations[0].Value.ValueKind != JsonValueKind.Object)
                    return false;

                organizationAlias = organizations[0].Name;
                var organization = organizations[0].Value;
                if (!TryReadUniqueOptionalStringProperty(organization, "id", out organizationId))
                    return false;

                var directTenantProperties = organization.EnumerateObject()
                    .Where(property => string.Equals(property.Name, tenantIdAttribute, StringComparison.Ordinal))
                    .ToArray();
                if (directTenantProperties.Length != 1)
                    return false;

                return TryReadSingleString(directTenantProperties[0].Value, out tenantId)
                    && string.Equals(tenantId, $"tnt_{organizationAlias}", StringComparison.Ordinal);
            }
            finally
            {
                unwrappedDocument?.Dispose();
            }
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool IsValidOrganizationAlias(string alias)
    {
        // tenant_id is capped at 32 characters and always includes the four-character
        // tnt_ prefix. Keep the alias contract aligned with Admin Portal/FE validation.
        if (alias.Length is < 1 or > 28)
            return false;

        return alias.All(character =>
            character is >= 'a' and <= 'z'
            or >= '0' and <= '9'
            or '_');
    }

    private static bool TryReadUniqueOptionalStringProperty(
        JsonElement element,
        string propertyName,
        out string? value)
    {
        value = null;
        var properties = element.EnumerateObject()
            .Where(property => string.Equals(property.Name, propertyName, StringComparison.Ordinal))
            .ToArray();

        if (properties.Length == 0)
            return true;

        if (properties.Length != 1
            || properties[0].Value.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(properties[0].Value.GetString()))
        {
            return false;
        }

        value = properties[0].Value.GetString();
        return true;
    }

    private static bool TryReadSingleString(JsonElement element, out string value)
    {
        value = string.Empty;
        if (element.ValueKind == JsonValueKind.String)
        {
            value = element.GetString() ?? string.Empty;
            return !string.IsNullOrWhiteSpace(value);
        }

        if (element.ValueKind != JsonValueKind.Array)
            return false;

        var values = element.EnumerateArray().ToArray();
        if (values.Length != 1 || values[0].ValueKind != JsonValueKind.String)
            return false;

        value = values[0].GetString() ?? string.Empty;
        return !string.IsNullOrWhiteSpace(value);
    }

    private sealed record TenantResolution(bool IsValid, TenantContext? Context)
    {
        public static TenantResolution Invalid { get; } = new(false, null);

        public static TenantResolution Valid(TenantContext? context) => new(true, context);
    }
}
