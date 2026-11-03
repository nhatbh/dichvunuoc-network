# Keycloak SSO Integration

This template supports a shared IAM based on Keycloak through a single browser-facing facade:

| Module                                                                                            | Role                                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`src/shared/lib/client-auth.ts`](../src/shared/lib/client-auth.ts)                               | Public `authClient` — the only entry point for routes, features, and HTTP.          |
| [`src/shared/lib/keycloak-auth.ts`](../src/shared/lib/keycloak-auth.ts)                           | Keycloak adapter (`keycloak-js`), PKCE, token refresh, JWT role/permission parsing. |
| [`src/shared/lib/auth-token.ts`](../src/shared/lib/auth-token.ts)                                 | Bearer token for `httpClient`.                                                      |
| [`src/shared/lib/route-guards.ts`](../src/shared/lib/route-guards.ts)                             | `authGuard()` — Keycloak triggers OIDC login; mock redirects to `/login`.           |
| [`src/entities/session/ui/session-provider.tsx`](../src/entities/session/ui/session-provider.tsx) | Session context + Keycloak event bridge (`attachKeycloakSessionSync`).              |

## Environment

```env
VITE_AUTH_MODE=keycloak
VITE_KEYCLOAK_URL=https://iam.example.com
VITE_KEYCLOAK_REALM=techgen
VITE_KEYCLOAK_CLIENT_ID=my-frontend-service
VITE_KEYCLOAK_ON_LOAD=check-sso
VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI=https://my-service.example.com/silent-check-sso.html
```

For local development without Keycloak:

```env
VITE_AUTH_MODE=mock
VITE_USE_MOCK_AUTH=true
```

Copy [`.env.example`](../.env.example) to `.env` and adjust values.

## `check-sso` vs `login-required`

| `VITE_KEYCLOAK_ON_LOAD` | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-sso` (default)   | On load, Keycloak runs a **silent SSO check** using `silentCheckSsoRedirectUri`. If the user already has a session at the IdP, tokens are issued without a visible redirect. If not, the SPA stays anonymous until `authClient.login()` runs (e.g. user opens `/login` or hits a protected route via `authGuard`). **Requires** `VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI` pointing at [`public/silent-check-sso.html`](../public/silent-check-sso.html) (absolute URL). |
| `login-required`        | Unauthenticated users are sent to Keycloak **immediately** on first `init`. Use for portals that should never render anonymously. Silent SSO URI is less critical but still recommended for refresh flows.                                                                                                                                                                                                                                                                  |

## Silent SSO redirect URI

- Must be an **absolute** URL: `https://host/silent-check-sso.html` or `http://localhost:3000/silent-check-sso.html`.
- Path must match the static file served by Vite (`public/silent-check-sso.html`).
- Register the same URL under the Keycloak client **Valid redirect URIs** (exact match or wildcard per your IAM policy).

## Multiple frontend services

Each SPA origin typically has:

- Its own **public client** in Keycloak (or a shared client only if IAM mandates it).
- **Valid redirect URIs** listing every deployment origin (e.g. `https://orders.example.com/*`, `https://reports.example.com/*`, `http://localhost:3001/*`).
- **Web origins** aligned with those hosts for CORS/browser checks.

`authClient.login(redirectUri)` and `authGuard()` pass the **return URL** after login; ensure those URLs stay within allowed redirect patterns.

## Organization-first tenant context

GIS keeps one public client per application (`water-network-gis-fe`). A tenant
is selected through Keycloak's standard Organization scope configured at
deploy time in `config.json`:

```json
{
  "organization": {
    "alias": "tenant_alias",
    "context": "required",
    "allowLegacyTenantIdFallback": false
  }
}
```

- With an alias, the adapter requests `scope=organization:<alias>`.
- Without an alias, it requests `scope=organization` and accepts exactly one
  selected Organization in the token.
- The authoritative tenant projection is
  `organization[alias].tenant_id = tnt_<alias>`. A top-level `tenant_id`, when
  still emitted during migration, must match but is not required.
- `allowLegacyTenantIdFallback` is an explicit, temporary escape hatch. Keep it
  `false` for Organization-first deployments.

### Keycloak version gate

The repository currently pins the server image to **Keycloak 26.0**. That
version can emit an Organization claim for a single membership, but it cannot
reliably select a tenant for multi-Organization users. Parameterized
`organization:<alias>` and interactive multi-org selection require **Keycloak
26.2 or newer** (Organization Selection support). The source config is prepared
for that cutover, but this GIS change deliberately does not upgrade the
Keycloak image.

The manual CWA staging overlay therefore remains in an explicit transition
mode: `context=disabled` plus `allowLegacyTenantIdFallback=true`. This exception
is scoped to that tenant overlay; it is not a production default.

Before enabling an alias-bearing runtime config:

1. Approve and perform the separate Keycloak upgrade to at least 26.2.
2. Confirm the Organization exists, is enabled, and has `tenant_id=tnt_<alias>`.
3. Confirm the user is an Organization member.
4. Evaluate the GIS client token and verify the nested `organization` claim.
5. Only then disable the flat `tenant_id` fallback and deploy the GIS config.

## Keycloak client setup (summary)

- Access type: **public**
- Standard flow: **enabled**
- PKCE: **S256** (enforced in code via `pkceMethod: 'S256'`)
- Direct access grants: **disabled** for browser-only apps
- Valid redirect URIs + Web origins: all app URLs + dev ports
- Optional: **Consent** / **Full scope** per org policy

## Roles and permissions in the SPA

The adapter maps JWT claims to `AuthSessionData`:

- **Roles:** `realm_access.roles` and `resource_access[VITE_KEYCLOAK_CLIENT_ID].roles`
- **Permissions:** top-level `permissions` claim and Keycloak Authorization Services `authorization.permissions` (normalized to `resource:scope`)

UI helpers:

- [`src/shared/lib/auth-role.ts`](../src/shared/lib/auth-role.ts) derives the template `Role` from `roles[]` (and optional singular `role` claim).
- [`src/shared/lib/hooks/use-permission.ts`](../src/shared/lib/hooks/use-permission.ts) checks **token permissions first**, then static RBAC in [`permissions.ts`](../src/shared/lib/permissions.ts) for UX only.

**APIs must enforce authorization server-side** — frontend checks are never sufficient.

## Route guards

Protected routes use `beforeLoad`:

```ts
beforeLoad: async () => {
  await authGuard()
}
```

- **Keycloak:** `authGuard` calls `authClient.login()` with the current URL as return target (OIDC redirect).
- **Mock:** redirects to `/login?redirect=/path`.

## Token lifecycle and HTTP

- `authClient.getAccessToken()` / `getSession()` refresh tokens with a **30s** minimum validity via `updateToken`.
- [`attachKeycloakSessionSync`](../src/shared/lib/keycloak-auth.ts) registers Keycloak `onTokenExpired`, `onAuthSuccess`, and `onAuthLogout` to **refresh session context** (and invalidate legacy `['session']` query keys if used).
- [`httpClient`](../src/shared/api/http-client.ts) on **401** attempts `authClient.updateToken(30)` once and **retries** the request with a new bearer token.

## Login and registration UI

When `VITE_AUTH_MODE=keycloak`, [`LoginPage`](../src/pages/auth/login/index.tsx) shows **Continue with SSO** instead of a local password form. [`RegisterPage`](../src/pages/auth/register/index.tsx) uses `authClient.signUp.email` → Keycloak self-service registration.

## Migration for existing services

1. Upgrade the template while keeping `VITE_AUTH_MODE=mock`.
2. Register the SPA client in Keycloak and configure redirect URIs + silent SSO URL.
3. Add Keycloak env vars per environment.
4. Switch **one** non-production environment to `keycloak` and run through login, logout, protected routes, API calls, and 401 refresh.
5. Align realm/client **role names** with [`ROLES`](../src/shared/lib/permissions.ts) or rely on token **permissions** for fine-grained UI.
6. Roll out to remaining environments; tag the template (`template/vX.Y.Z`) and read [`CHANGELOG-template.md`](../CHANGELOG-template.md) + [`docs/migrations/`](./migrations/).

## Manual QA checklist (Keycloak)

- [ ] Silent SSO page loads without console errors (`check-sso` mode).
- [ ] First visit anonymous; protected route triggers login; return URL correct.
- [ ] Logout clears app session and Keycloak session (verify IdP behavior).
- [ ] API returns 200 after access token near-expiry (implicitly exercises refresh + optional HTTP retry).
- [ ] Roles/permissions in JWT match UI visibility (admin vs user paths).
