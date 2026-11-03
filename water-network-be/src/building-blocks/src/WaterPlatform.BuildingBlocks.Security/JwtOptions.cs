namespace WaterPlatform.BuildingBlocks.Security;

/// <summary>
/// Configuration options for JWT-based authentication.
/// </summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    /// <summary>
    /// Authentication mode.
    /// </summary>
    /// <remarks>
    /// <c>Mock</c> (default) uses a local symmetric key for development and testing.
    /// <c>Authority</c> switches to real Keycloak OIDC discovery purely via configuration —
    /// no code changes are required.
    /// </remarks>
    public string Mode { get; set; } = "Mock"; // Mock | Authority (real Keycloak — switch via config later)

    public string Issuer { get; set; } = "water-platform-dev";

    public string Audience { get; set; } = "water-platform";

    /// <summary>
    /// OIDC authorized-party (<c>azp</c>) values accepted by this API.
    /// </summary>
    /// <remarks>
    /// An empty collection preserves the platform's legacy behavior and does not validate
    /// <c>azp</c>. When one or more values are configured, an authenticated token must contain
    /// exactly one <c>azp</c> claim and its value must match this allowlist using ordinal,
    /// case-sensitive comparison.
    /// </remarks>
    public string[] AllowedAuthorizedParties { get; set; } = [];

    /// <summary>
    /// Symmetric key used when <see cref="Mode"/> is <c>Mock</c>.
    /// </summary>
    /// <remarks>
    /// For development and testing only. This key is never consulted when
    /// <see cref="Mode"/> is <c>Authority</c>; Keycloak's public keys are used instead.
    /// </remarks>
    public string MockSigningKey { get; set; } = "water-platform-dev-signing-key-min-32-chars!";

    /// <summary>
    /// Keycloak authority URL. Required when <see cref="Mode"/> is <c>Authority</c>.
    /// Ignored in <c>Mock</c> mode.
    /// </summary>
    public string? Authority { get; set; }
}
