using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace WaterPlatform.BuildingBlocks.Security;

/// <summary>
/// Creates signed JWT tokens for development and test scenarios when <see cref="JwtOptions.Mode"/> is <c>Mock</c>.
/// </summary>
public static class DevJwtTokenFactory
{
    /// <summary>
    /// Creates a signed JWT token carrying the supplied identity and permission claims.
    /// </summary>
    /// <param name="options">JWT configuration (issuer, audience, signing key).</param>
    /// <param name="subject">The <c>sub</c> claim value (user identifier).</param>
    /// <param name="tenantId">The <c>tenant_id</c> claim value. Required.</param>
    /// <param name="organizationId">Optional <c>organization_id</c> claim. Omitted when <see langword="null"/>.</param>
    /// <param name="branchId">Optional <c>branch_id</c> claim. Omitted when <see langword="null"/>.</param>
    /// <param name="permissions">Zero or more <c>permission</c> claims (e.g. <c>"network-gis:write"</c>).</param>
    /// <returns>A compact-serialized JWT string valid for one hour.</returns>
    public static string CreateToken(
        JwtOptions options,
        string subject,
        string tenantId,
        string? organizationId = null,
        string? branchId = null,
        params string[] permissions)
        => CreateTokenCore(
            options,
            subject,
            tenantId,
            organizationId,
            branchId,
            authorizedParty: null,
            permissions);

    /// <summary>
    /// Creates a signed development token for a specific OIDC authorized party.
    /// </summary>
    public static string CreateTokenForAuthorizedParty(
        JwtOptions options,
        string subject,
        string tenantId,
        string authorizedParty,
        string? organizationId = null,
        string? branchId = null,
        params string[] permissions)
        => CreateTokenCore(
            options,
            subject,
            tenantId,
            organizationId,
            branchId,
            authorizedParty,
            permissions);

    private static string CreateTokenCore(
        JwtOptions options,
        string subject,
        string tenantId,
        string? organizationId,
        string? branchId,
        string? authorizedParty,
        string[] permissions)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subject),
            new("tenant_id", tenantId)
        };

        if (organizationId is not null)
            claims.Add(new Claim("organization_id", organizationId));

        if (branchId is not null)
            claims.Add(new Claim("branch_id", branchId));

        if (authorizedParty is not null)
            claims.Add(new Claim(JwtRegisteredClaimNames.Azp, authorizedParty));

        claims.AddRange(permissions.Select(p => new Claim("permission", p)));

        return WriteToken(options, claims);
    }

    /// <summary>
    /// Creates a development token with zero or more <c>azp</c> claims.
    /// </summary>
    /// <remarks>
    /// This overload is intended for authentication-boundary tests, including malformed-token
    /// cases with a missing or repeated authorized party.
    /// </remarks>
    public static string CreateTokenWithAuthorizedParties(
        JwtOptions options,
        string subject,
        string tenantId,
        IEnumerable<string> authorizedParties,
        params string[] permissions)
    {
        ArgumentNullException.ThrowIfNull(authorizedParties);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subject),
            new("tenant_id", tenantId)
        };

        claims.AddRange(authorizedParties.Select(value =>
            new Claim(JwtRegisteredClaimNames.Azp, value)));
        claims.AddRange(permissions.Select(permission =>
            new Claim("permission", permission)));

        return WriteToken(options, claims);
    }

    /// <summary>
    /// Creates a development token whose tenant context is carried by the selected
    /// Keycloak Organization claim.
    /// </summary>
    /// <remarks>
    /// The generated shape matches Keycloak's Organization Membership mapper when
    /// organization attributes and id are enabled:
    /// <c>organization[alias].tenant_id</c> and <c>organization[alias].id</c>.
    /// </remarks>
    public static string CreateOrganizationToken(
        JwtOptions options,
        string subject,
        string organizationAlias,
        string tenantId,
        string organizationId,
        string? flatTenantId = null,
        string? branchId = null,
        params string[] permissions)
        => CreateOrganizationTokenCore(
            options,
            subject,
            organizationAlias,
            tenantId,
            organizationId,
            flatTenantId,
            branchId,
            authorizedParty: null,
            permissions);

    /// <summary>
    /// Creates a Keycloak Organization-shaped development token for a specific OIDC
    /// authorized party.
    /// </summary>
    public static string CreateOrganizationTokenForAuthorizedParty(
        JwtOptions options,
        string subject,
        string organizationAlias,
        string tenantId,
        string organizationId,
        string authorizedParty,
        string? flatTenantId = null,
        string? branchId = null,
        params string[] permissions)
        => CreateOrganizationTokenCore(
            options,
            subject,
            organizationAlias,
            tenantId,
            organizationId,
            flatTenantId,
            branchId,
            authorizedParty,
            permissions);

    private static string CreateOrganizationTokenCore(
        JwtOptions options,
        string subject,
        string organizationAlias,
        string tenantId,
        string organizationId,
        string? flatTenantId,
        string? branchId,
        string? authorizedParty,
        string[] permissions)
    {
        var organizationJson = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            [organizationAlias] = new
            {
                id = organizationId,
                tenant_id = new[] { tenantId }
            }
        });

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subject),
            new("scope", $"openid organization:{organizationAlias}"),
            new("organization", organizationJson, JsonClaimValueTypes.Json)
        };

        if (flatTenantId is not null)
            claims.Add(new Claim("tenant_id", flatTenantId));

        if (branchId is not null)
            claims.Add(new Claim("branch_id", branchId));

        if (authorizedParty is not null)
            claims.Add(new Claim(JwtRegisteredClaimNames.Azp, authorizedParty));

        claims.AddRange(permissions.Select(permission => new Claim("permission", permission)));

        return WriteToken(options, claims);
    }

    private static string WriteToken(JwtOptions options, IEnumerable<Claim> claims)
    {
        var claimList = claims.ToArray();

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.MockSigningKey)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: options.Issuer,
            audience: options.Audience,
            claims: claimList,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
