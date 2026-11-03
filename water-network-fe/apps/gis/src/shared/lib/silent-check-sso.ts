/** Resolve the Keycloak silent-check-sso redirect URI, defaulting to the current origin. */
export function resolveSilentCheckSsoRedirectUri(configured: string, origin: string): string {
  return configured || `${origin}/silent-check-sso.html`
}
