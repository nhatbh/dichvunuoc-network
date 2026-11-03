# Backend-session (BFF / cookie auth)

Use `VITE_AUTH_MODE=backend-session` when a **BFF or API gateway** owns the session via **httpOnly cookies** instead of browser Bearer tokens.

## Contract

| Endpoint         | Method | Notes                                            |
| ---------------- | ------ | ------------------------------------------------ |
| `/auth/csrf`     | GET    | Returns `{ csrfToken: string }`                  |
| `/auth/login`    | POST   | Body: `{ email, password }`, sets session cookie |
| `/auth/register` | POST   | Body: `{ email, password, name? }`               |
| `/auth/logout`   | POST   | Requires `X-CSRF-Token` header                   |
| `/auth/session`  | GET    | Returns `AuthSessionData` or 401                 |

## HTTP client behavior

- All requests use `credentials: 'include'` so cookies are sent.
- **No** `Authorization: Bearer` header in this mode.
- On **401**, the app redirects to `/login` (no Keycloak token refresh).

## CORS / deployment

- BFF must allow the SPA origin with `Access-Control-Allow-Credentials: true`.
- Cookies: `SameSite` and `Secure` per your environment.
- Prefer **same-site** deployment (SPA + BFF under one site) when possible.

## Implementation

- Adapter: `src/shared/lib/backend-session-auth.ts`
- Mode detection: `src/shared/config/auth-mode.ts`
