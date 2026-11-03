# Frontend Template — Solid + TanStack + FSD

A **Vite + SolidJS** single-page application template organized with **Feature-Sliced Design (FSD)**. Use it as the baseline for **UI-only microservices**: business APIs and auth live in your separate backends; this repo stays focused on routing, state, and presentation.

## Tech Stack

| Layer   | Tool                                           |
| ------- | ---------------------------------------------- |
| Build   | Vite 5 + TypeScript (strict)                   |
| UI      | SolidJS 1.9, Kobalte (headless), Tailwind CSS  |
| Routing | TanStack Solid Router (file-based)             |
| Data    | TanStack Solid Query                           |
| Forms   | @modular-forms/solid + Zod                     |
| Auth    | Keycloak SSO / Mock (configurable)             |
| Testing | Vitest + @solidjs/testing-library + Playwright |
| Lint    | ESLint 9 flat config + Prettier + Husky        |

## Architecture (FSD)

```
src/
├── app/           # App shell, providers, global styles
├── pages/         # Page compositions (route entry points)
├── widgets/       # Complex UI blocks (add as needed)
├── features/      # User interactions (auth, domain features)
├── entities/      # Business entities (session, domain slices)
├── shared/        # UI kit, API client, utils, hooks, config
├── routes/        # TanStack Router file-based routes (thin)
└── routeTree.gen.ts  # Auto-generated
```

## Quick Start

```bash
npm install
cp .env.example .env    # configure VITE_API_URL, VITE_AUTH_MODE, etc.
npm run prepare         # setup git hooks
npm run dev             # http://localhost:3000
```

## Environment Variables

| Variable                  | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `VITE_API_URL`            | Base URL for your HTTP API                 |
| `VITE_AUTH_MODE`          | `mock`, `keycloak`, or `backend-session`   |
| `VITE_KEYCLOAK_URL`       | Keycloak base URL (when mode=keycloak)     |
| `VITE_KEYCLOAK_REALM`     | Keycloak realm name                        |
| `VITE_KEYCLOAK_CLIENT_ID` | Public frontend client ID                  |
| `VITE_USE_MOCK_DATA`      | `true` to enable MSW in dev                |
| `VITE_API_TIMEOUT`        | HTTP timeout (ms), default `30000`         |
| `VITE_SECONDARY_API_URL`  | Optional second microservice base URL      |
| `VITE_USE_RUNTIME_CONFIG` | Load `public/config.json` at startup       |
| `VITE_MENU_APP_URL`       | Shell app URL for cross-app SSO navigation |

## Microservices FE fleet

Each backend domain (or bounded context) can ship as its own SPA cloned from this template.

### API strategy

| Approach              | Config                                                            | When                                           |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| **API gateway**       | Single `VITE_API_URL` → gateway                                   | Most fleets; one `httpClient`                  |
| **Multiple services** | `VITE_API_URL` + `VITE_SECONDARY_API_URL` or `createHttpClient()` | Direct calls per service                       |
| **Runtime**           | `public/config.json`                                              | Same image, different env URLs without rebuild |

### Keycloak per app

- One **realm** shared across Menu App and MiniApps.
- One **public client per SPA** (or shared client if IAM allows).
- MiniApps: `VITE_KEYCLOAK_ON_LOAD=check-sso` + `silent-check-sso.html`.
- See [`docs/cross-app-sso.md`](./docs/cross-app-sso.md).

### Deploy checklist

1. `npm run build` → serve `dist/` with nginx (see `Dockerfile`, `nginx.conf`).
2. Set `connect-src` in `nginx.conf` CSP to your API + IAM hosts.
3. Copy `public/config.json.example` → `config.json` if using runtime config.
4. Health: `GET /health` (nginx).

### Scaffold a new service

```bash
./scripts/scaffold.sh my-service ../my-service
cd ../my-service && npm install && npm run dev
```

### Reference slice

Open `/sample-items` (protected) to see entity → feature → page wiring. Clone `src/entities/sample-item/` when adding domains.

## Scripts

```bash
npm run dev             # Dev server (port 3000)
npm run build           # Production build
npm run typecheck       # tsc --noEmit (regenerates routes first)
npm run lint            # ESLint
npm run test:run        # Vitest (single run)
npm run test            # Vitest (watch)
npm run test:e2e        # Playwright E2E
npm run routes:generate # Refresh routeTree.gen.ts
npm run size            # Bundle size budget (after build)
```

## Authentication

The template ships a pluggable auth facade (`src/shared/lib/client-auth.ts`):

- **`mock`** — localStorage-based mock for local dev
- **`keycloak`** — Authorization Code + PKCE via keycloak-js
- **`backend-session`** — Cookie-based BFF sessions

Route protection uses TanStack Router `beforeLoad` + `authGuard()`.

## Adding Features

1. Create entity under `src/entities/your-domain/`
2. Create feature under `src/features/your-feature/`
3. Create page under `src/pages/your-page/`
4. Add route under `src/routes/your-page.tsx`
5. Run `npm run routes:generate`

## Template Upgrades

See [`CHANGELOG-template.md`](./CHANGELOG-template.md) and [`docs/migrations/`](./docs/migrations/) for breaking changes between template versions. Tag releases as `template/vX.Y.Z`.

## Documentation

- [`docs/auth-keycloak.md`](./docs/auth-keycloak.md) — Keycloak SSO setup
- [`docs/EVENT_BUS_GUIDE.md`](./docs/EVENT_BUS_GUIDE.md) — Event-driven architecture
- [`docs/ARCHITECTURE_RULES.md`](./docs/ARCHITECTURE_RULES.md) — FSD rules (Solid)
- [`docs/backend-session-bff.md`](./docs/backend-session-bff.md) — Cookie/BFF auth
- [`docs/cross-app-sso.md`](./docs/cross-app-sso.md) — Menu App + MiniApps SSO
- [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) — Contributing guide
