/**
 * Cross-App SSO Navigation
 *
 * Handles seamless authentication when navigating between the Menu App (shell)
 * and MiniApps (child services) deployed on different URLs/domains.
 *
 * Architecture:
 * - Menu App authenticates user via Keycloak (single login)
 * - MiniApps use `check-sso` (silent) to pick up existing Keycloak session
 * - If MiniApp cannot silently authenticate, it redirects to Keycloak login
 *   which immediately resolves (no password prompt) because session exists
 *
 * Requirements:
 * - All apps must use the same Keycloak realm
 * - Keycloak must allow redirect URIs for all app domains
 * - For cross-origin cookie sharing, apps should be on same parent domain
 *   (e.g., menu.example.com, app-a.example.com) OR use Keycloak's
 *   cross-origin support
 *
 * Usage from Menu App:
 *   import { navigateToMiniApp } from '@/shared/lib/cross-app-sso'
 *   navigateToMiniApp('https://miniapp-a.example.com/dashboard')
 *
 * Usage in MiniApp (env config):
 *   VITE_AUTH_MODE=keycloak
 *   VITE_KEYCLOAK_ON_LOAD=check-sso
 *   VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI=https://miniapp-a.example.com/silent-check-sso.html
 */

import { env } from '@/shared/config/env'
import { authClient } from './client-auth'

/**
 * Navigate from Menu App to a MiniApp with SSO context.
 *
 * Strategies (in priority order):
 * 1. Token relay via URL fragment (short-lived, for same-trust-zone apps)
 * 2. Plain navigation (relies on Keycloak SSO session cookie)
 *
 * Strategy 1 is useful when cookie-based SSO is unreliable (different TLDs).
 * Strategy 2 is the default and recommended for same-domain deployments.
 */
export async function navigateToMiniApp(
  targetUrl: string,
  options: NavigateToMiniAppOptions = {}
): Promise<void> {
  const { strategy = 'sso-session', openInNewTab = false } = options

  if (strategy === 'token-relay') {
    await navigateWithTokenRelay(targetUrl, openInNewTab)
  } else {
    navigateWithSsoSession(targetUrl, openInNewTab)
  }
}

export interface NavigateToMiniAppOptions {
  /**
   * SSO strategy:
   * - 'sso-session': Rely on Keycloak SSO session cookie (default, recommended)
   * - 'token-relay': Pass a short-lived token via URL for cross-domain scenarios
   */
  strategy?: 'sso-session' | 'token-relay'
  /** Open in new tab instead of same window */
  openInNewTab?: boolean
}

/**
 * Strategy 1: Token Relay
 *
 * Passes a short-lived authorization hint via URL hash fragment.
 * The target MiniApp reads the hint and exchanges it for a session.
 *
 * Security considerations:
 * - Token is in URL fragment (not sent to server, not in history)
 * - MiniApp should clear fragment immediately after reading
 * - Only use between trusted apps in the same organization
 */
async function navigateWithTokenRelay(targetUrl: string, openInNewTab: boolean): Promise<void> {
  const token = await authClient.getAccessToken()

  if (!token) {
    // Not authenticated - just navigate, MiniApp will handle login
    navigateTo(targetUrl, openInNewTab)
    return
  }

  // Create a login hint URL that the MiniApp can use
  // The MiniApp's auth initializer will detect this and use it
  const url = new URL(targetUrl)
  url.searchParams.set('sso_hint', 'keycloak')
  url.searchParams.set('kc_idp_hint', '') // Skip IDP selection if any
  url.hash = `access_token=${encodeURIComponent(token)}`

  navigateTo(url.toString(), openInNewTab)
}

/**
 * Strategy 2: SSO Session (recommended)
 *
 * Simply navigates to the target URL. The MiniApp's Keycloak adapter
 * will perform a silent check-sso and pick up the existing session
 * from the Keycloak cookie.
 *
 * This works when:
 * - Apps are on the same parent domain (cookie sharing)
 * - OR Keycloak is configured to allow the target domain's redirect URI
 */
function navigateWithSsoSession(targetUrl: string, openInNewTab: boolean): void {
  navigateTo(targetUrl, openInNewTab)
}

function navigateTo(url: string, openInNewTab: boolean): void {
  if (openInNewTab) {
    window.open(url, '_blank', 'noopener,noreferrer')
  } else {
    window.location.href = url
  }
}

/**
 * Handle incoming SSO hint from Menu App (called in MiniApp's auth init).
 *
 * If the URL contains `sso_hint=keycloak`, this triggers Keycloak login
 * with `prompt=none` which silently authenticates if session exists.
 * Then cleans up the URL.
 */
export function handleIncomingSsoHint(): boolean {
  if (typeof window === 'undefined') return false

  const url = new URL(window.location.href)
  const ssoHint = url.searchParams.get('sso_hint')

  if (ssoHint === 'keycloak') {
    // Clean up the URL params
    url.searchParams.delete('sso_hint')
    url.searchParams.delete('kc_idp_hint')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    return true
  }

  return false
}

/**
 * Check if current app has a valid SSO session without prompting login.
 *
 * Useful for MiniApp startup to determine auth state silently.
 * Returns true if user is already authenticated via SSO.
 */
export async function hasSsoSession(): Promise<boolean> {
  try {
    const session = await authClient.getSession()
    return session !== null
  } catch {
    return false
  }
}

/**
 * Get the Menu App URL for "back to menu" navigation.
 * Configurable via VITE_MENU_APP_URL env variable.
 */
export function getMenuAppUrl(): string {
  return env.VITE_MENU_APP_URL || '/'
}

/**
 * Navigate back to Menu App (from MiniApp).
 */
export function navigateToMenuApp(path = '/'): void {
  const baseUrl = getMenuAppUrl()
  const url = baseUrl.endsWith('/') ? `${baseUrl}${path.replace(/^\//, '')}` : `${baseUrl}${path}`
  window.location.href = url
}
