namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed class TenantOptions
{
    public const string SectionName = "MultiTenancy";

    /// <summary>
    /// Allows the tenant to be resolved from the <see cref="TenantHeader"/> HTTP header
    /// when no tenant claim is present in the authenticated user's identity.
    /// </summary>
    /// <remarks>
    /// Security-sensitive: enables unauthenticated tenant resolution via an HTTP header.
    /// Intended for local development only. Production startup rejects this setting even
    /// when a gateway is present; production tenant context must come from a signed token.
    /// </remarks>
    public bool AllowHeaderFallback { get; set; }

    /// <summary>
    /// Allows a signed, flat <see cref="TenantClaim"/> to establish the tenant only when
    /// the token has no <see cref="OrganizationClaim"/>.
    /// </summary>
    /// <remarks>
    /// This is a temporary compatibility switch for tokens issued before Keycloak
    /// Organizations became the tenant source of truth. Keep it disabled in production
    /// once every client emits the selected organization with its <c>tenant_id</c> attribute.
    /// An organization claim, when present, is always authoritative and must be valid.
    /// </remarks>
    public bool AllowFlatTenantClaimCompatibility { get; set; }

    public string TenantClaim { get; set; } = "tenant_id";
    public string OrganizationClaim { get; set; } = "organization";
    public string OrganizationTenantIdAttribute { get; set; } = "tenant_id";
    public string BranchClaim { get; set; } = "branch_id";
    public string TenantHeader { get; set; } = "X-Tenant-Id";
}
