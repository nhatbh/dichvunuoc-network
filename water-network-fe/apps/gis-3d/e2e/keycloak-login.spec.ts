/**
 * Keycloak Login Redirect E2E Spec
 *
 * NOTE: This spec does NOT require a live Keycloak instance. It intercepts
 * the navigation request before it leaves the browser and validates that the
 * URL the SPA constructs for Keycloak contains the required PKCE parameters
 * for `water-network-gis`. The KC navigation is aborted — no real auth-dev
 * connection is made.
 *
 * It does NOT perform an actual login.
 *
 * ENV GATE: This spec is SKIPPED by default. The default `playwright test`
 * run serves the app via the webServer block (mock auth mode, no
 * VITE_AUTH_MODE=keycloak), so the SSO button never renders and these tests
 * would always fail. Set GIS_E2E_KEYCLOAK=1 to enable them.
 *
 * Prerequisites when enabled:
 *   - App served with VITE_AUTH_MODE=keycloak and config.json pointing at
 *     auth-dev.dichvunuoc.vn / realm water-platform / client water-network-gis
 *   - The `water-network-gis` client must exist in the realm for staging runs
 *     (Task 6 manifest applied via `kubectl apply -k deploy/k3s/keycloak` on
 *     tino-32); not required for local interception-only runs.
 *
 * Running against the built keycloak-mode container (from water-network-fe/):
 *
 *   # 1. Build the image
 *   docker build -f apps/gis/Dockerfile -t water-network-gis:e2e .
 *
 *   # 2. Write a staging config (substitute real staging values):
 *   cat > /tmp/gis-config.json <<'EOF'
 *   {
 *     "apiUrl": "https://api-dev.dichvunuoc.vn",
 *     "keycloakUrl": "https://auth-dev.dichvunuoc.vn",
 *     "keycloakRealm": "water-platform",
 *     "keycloakClientId": "water-network-gis",
 *     "appName": "GIS"
 *   }
 *   EOF
 *
 *   # 3. Run the container (nginx serves on port 8080 inside)
 *   docker run -d --name gis-e2e -p 18099:8080 \
 *     -v /tmp/gis-config.json:/usr/share/nginx/html/config.json:ro \
 *     water-network-gis:e2e
 *
 *   # 4. Run the spec (VITE_E2E_BASE_URL is read by playwright.config.ts)
 *   GIS_E2E_KEYCLOAK=1 VITE_E2E_BASE_URL=http://localhost:18099 \
 *     npx playwright test e2e/keycloak-login.spec.ts --project=chromium
 *
 *   # 5. Cleanup
 *   docker rm -f gis-e2e && docker rmi water-network-gis:e2e
 */

import { test, expect } from '@playwright/test'

const KEYCLOAK_HOST = 'auth-dev.dichvunuoc.vn'
const EXPECTED_CLIENT_ID = 'water-network-gis'
const EXPECTED_PKCE_METHOD = 'S256'

const KEYCLOAK_MODE = process.env.GIS_E2E_KEYCLOAK === '1'

test.describe('Keycloak Login Redirect', () => {
  test.skip(
    !KEYCLOAK_MODE,
    'Requires the app served in VITE_AUTH_MODE=keycloak (e.g. the built container). ' +
      'Set GIS_E2E_KEYCLOAK=1 and point VITE_E2E_BASE_URL at a keycloak-mode server.',
  )

  test('clicking "Continue with SSO" navigates to Keycloak with correct PKCE params', async ({
    page,
    context,
  }) => {
    // Capture the redirect request before it leaves the browser.
    // We intercept navigation to the Keycloak host and abort it — we only
    // care that the URL is constructed correctly, not that we reach auth-dev.
    let capturedAuthUrl: URL | null = null

    // Register a route handler that intercepts any navigation to the KC host.
    await context.route(`**://${KEYCLOAK_HOST}/**`, route => {
      capturedAuthUrl = new URL(route.request().url())
      // Abort the navigation so the test does not depend on KC being reachable.
      void route.abort()
    })

    await page.goto('/login')

    // In Keycloak mode the page shows the SSO button; wait for it to appear.
    const ssoButton = page.getByRole('button', { name: /continue with sso/i })
    await expect(ssoButton).toBeVisible()

    // Click triggers kc.login() → browser navigation to KC auth endpoint.
    // The context.route handler will intercept and abort it.
    await ssoButton.click()

    // Wait until the route handler has captured the URL (deterministic).
    // If this times out the redirect never fired — likely a config/KC-init bug.
    await expect.poll(() => capturedAuthUrl, { timeout: 5000 }).not.toBeNull()

    // Assertions on the intercepted URL.
    expect(capturedAuthUrl).not.toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const authUrl = capturedAuthUrl!

    // Must target our auth-dev host.
    expect(authUrl.hostname).toBe(KEYCLOAK_HOST)

    // Must include the water-platform realm path.
    expect(authUrl.pathname).toContain('/realms/water-platform/')

    // Must be the OIDC authorization endpoint.
    expect(authUrl.pathname).toContain('/protocol/openid-connect/auth')

    // Must identify the correct client.
    expect(authUrl.searchParams.get('client_id')).toBe(EXPECTED_CLIENT_ID)

    // Must use PKCE with S256 (proves PKCE is enabled, not implicit flow).
    expect(authUrl.searchParams.get('code_challenge_method')).toBe(EXPECTED_PKCE_METHOD)

    // Must include a code_challenge (non-empty).
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy()

    // Must request the authorization code flow.
    expect(authUrl.searchParams.get('response_type')).toBe('code')
  })

  test('config.json is loaded and keycloak settings are applied', async ({ page }) => {
    // Intercept the config.json fetch to inject staging-like config without
    // requiring the real container. This validates the runtime-config path works
    // in a browser context.
    await page.route('**/config.json', route => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          apiUrl: 'https://api-dev.dichvunuoc.vn',
          keycloakUrl: `https://${KEYCLOAK_HOST}`,
          keycloakRealm: 'water-platform',
          keycloakClientId: EXPECTED_CLIENT_ID,
          appName: 'GIS',
        }),
      })
    })

    // Also intercept any navigation to KC so the test does not depend on network.
    let capturedAuthUrl: URL | null = null
    await page.context().route(`**://${KEYCLOAK_HOST}/**`, route => {
      capturedAuthUrl = new URL(route.request().url())
      void route.abort()
    })

    await page.goto('/login')

    const ssoButton = page.getByRole('button', { name: /continue with sso/i })
    await expect(ssoButton).toBeVisible()
    await ssoButton.click()

    // Wait until the route handler has captured the URL (deterministic).
    // If this times out, the redirect never fired — likely a runtime-config
    // parse error or KC-init bug; the config.json interception above did not
    // propagate correctly.
    await expect.poll(() => capturedAuthUrl, { timeout: 5000 }).not.toBeNull()

    // Unconditional: if capturedAuthUrl is null here the test must fail —
    // a null value means the config injection did not work.
    expect(capturedAuthUrl).not.toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const authUrl = capturedAuthUrl!
    expect(authUrl.searchParams.get('client_id')).toBe(EXPECTED_CLIENT_ID)
  })
})
