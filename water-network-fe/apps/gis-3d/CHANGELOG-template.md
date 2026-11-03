# Changelog — frontend-sample template

Consumers fork or sync this repo as a baseline for **UI-only** services (see [README.md](README.md)). Use [SemVer](https://semver.org/) tags on this template (for example `template/v1.0.0`) and record breaking changes here so downstream repos can upgrade in order.

## How to upgrade a derived UI service

1. Fetch tags from this template remote and read the section for your current tag → target tag.
2. Merge or cherry-pick template `main` into your service repo, resolving conflicts preferring **your** `entities/`, `features/`, `pages/`, `routes/`, and `.env`.
3. Run `npm ci`, `npm run typecheck`, `npm run test:run`, and (optionally) Playwright locally.
4. Re-apply any customizations in `src/shared/lib/client-auth.ts` if you replaced mock auth with your backend.

## Unreleased

### Breaking (when released, move under a dated version header)

- Permission hooks moved from `@/shared/lib/hooks` to `@/entities/session` (import `usePermission` from `@/entities/session`).
- **Error handling unified.** `httpClient` now throws `ApiError` (with `statusCode`) instead of a plain `Error`, and no longer shows toasts itself. Toasts are emitted centrally by the global TanStack Query error handler in `app/providers/query-provider.tsx`. Opt out per query/mutation with `meta: { skipErrorToast: true }`. The `RequestConfig.skipErrorToast` option was removed (use `meta` instead); `skipAuth` is unchanged. `handleApiError` no longer auto-redirects on 401 — the 401 → token refresh → login redirect flow is owned solely by `httpClient`.
- **RBAC slimmed to a mechanism.** `permissions.ts` no longer ships the blog/payment permission catalog or fictional `/admin`,`/moderate`,`/profile` routes; `Permission` is now `string`. The full example moved to `src/shared/lib/permissions.example.ts` (not imported). Static `rolePermissions` is empty by default — permission checks fall back to the IdP token claims on the session. If you relied on the old static grants, copy them from the example file.

### Added / changed (working tree — copy into next `template/v…` section when you tag)

- Centralized error presentation via `QueryCache`/`MutationCache` `onError`; new `toastApiError()` (display-only, never throws/redirects) alongside `handleApiError()`.
- Mock RBAC is now configurable for local guard testing: `VITE_MOCK_ROLES` / `VITE_MOCK_PERMISSIONS` (comma-separated) feed the mock session; `authClient.hasRole/hasPermission` read from it instead of being hardcoded.
- Fail-fast env validation: `VITE_AUTH_MODE=keycloak` now requires URL/realm/clientId; production requires `VITE_API_URL` unless `VITE_USE_RUNTIME_CONFIG` is enabled. Error messages list the offending vars.
- New `widgets` layer example: `src/widgets/page-header/` (+ `widgets/README.md`), wired into `/sample-items`.
- Tests added for `http-client`, `error-handler`, `permissions`, `route-guards`, and `env` validation (13 → 56 tests).
- `backend-session` HTTP client: `credentials: 'include'`, no Bearer; docs in `docs/backend-session-bff.md`.
- Reference vertical slice: `sample-item` entity, `refresh-sample-items` feature, `/sample-items` route.
- Runtime config: `public/config.json` + `src/bootstrap.ts`.
- Multi-service HTTP: `createHttpClient()`, `VITE_SECONDARY_API_URL`, `VITE_API_TIMEOUT`.
- FSD enforcement: `eslint-plugin-boundaries`, Husky + lint-staged, CI `size` job.
- Docs: Solid-aligned `ARCHITECTURE_RULES.md`, README microservices fleet section.

---

## template/v1.1.0 — 2026-05-12

### Summary

IAM alignment for Keycloak SSO, session refresh wiring, HTTP 401 token retry, Playwright isolation on port **4173**, and documentation updates.

### Migrate

1. **Playwright / CI:** Default E2E `baseURL` and `webServer` now use `http://localhost:4173`. Remove `VITE_E2E_BASE_URL=http://localhost:3000` from CI unless you intentionally override. Local `npm run dev` remains on port **3000**.
2. **Route `/login`:** Optional validated search param `redirect` (string). Deep links may use `/login?redirect=/dashboard`.
3. **`authGuard()`:** In `VITE_AUTH_MODE=keycloak`, unauthenticated users are sent through **`authClient.login()`** (OIDC) instead of only `/login`.
4. **Removed** unused `src/app/middleware.ts` — references in internal docs were updated; delete any fork-local imports.
5. **Mock session shape:** `getSession()` no longer returns internal `User`/`Session` types; it returns `AuthSessionData` with `user.roles: ['user']` for RBAC hooks.
6. **New modules:** `src/shared/lib/auth-role.ts` (`deriveAppRoleFromSession`), `attachKeycloakSessionSync` in `keycloak-auth.ts`, `e2e/helpers/mock-login.ts`.

### Details

- **RBAC:** `deriveAppRoleFromSession` maps Keycloak `roles[]` to template `Role`; permission hooks honor JWT `permissions` then static `permissions.ts`.
- **Keycloak:** `attachKeycloakSessionSync` invalidates session context on token/auth events; `httpClient` retries once after `401` when `updateToken` succeeds.
- **Docs:** Expanded `docs/auth-keycloak.md`, `.env.example` Keycloak/Sentry alignment, migration notes in `docs/migrations/template-v1.1.0.md`.

---

## template/v1.0.0 — YYYY-MM-DD

- Initial changelog structure for template consumers.

---

_Add new version blocks above when you tag releases._
