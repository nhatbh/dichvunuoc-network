# water-network-gis-3d

3D version of the GIS app (`apps/gis`), kept separate from it. Same screens and
features (viewer, editor, digitize, CAD import/georeference, auth, mocks); the map is
`@wn/map-runtime-3d` (MapLibre + deck.gl) instead of OpenLayers. Adds a 3D control
cluster (2D/3D, tilt, rotate, compass, buildings, terrain) and the `liberty`
OpenFreeMap basemap. Dev port **4600**; build via `apps/gis-3d/Dockerfile` from
`water-network-fe/`. See `docs/decisions/0015-3d-map-runtime.md`.

## Run without Docker / a backend

```
npm install            # then:
npm run dev:mock       # http://localhost:4600 — loads .env.mock
```

Sign in with `demo@example.com` / `password123`. Mock Service Worker serves the data in
the browser: `/full` returns a synthetic central-Hanoi network (~1,300 pipes, ~285 km, 6 DMAs:
Hoàn Kiếm, Ba Đình, Tây Hồ, Đống Đa, Hai Bà Trưng, Long Biên) with a plant at Yên Phụ, a
reservoir, two booster pumps, trunk mains DN300–600, Red River bridge crossings and
closed DMA-boundary valves. It is generated deterministically by
`src/shared/api/mocks/hanoi-network.ts` (landmark-anchored, **not** real utility records)
and rebased/geo-anchored by `legacy-full-seed.ts`.

**Make the pipes follow real streets (optional, run once):** `pnpm run osm:fetch` downloads roads,
water and building centroids for central Hanoi from OpenStreetMap (Overpass API; needs Node 18+ and
internet) into `src/shared/api/mocks/osm-hanoi.json`. When that file exists, `osm-network.ts` lays
the pipes along the real streets (mains on primary/secondary roads, distribution on residential
streets) and puts customer meters at real buildings; when it is missing the synthetic grid is used.
If Overpass is unavailable, download an OSM extract (BBBike / Geofabrik `.osm.gz`, any area) and run
`node scripts/convert-osm-extract.mjs path/to/extract.osm.gz` instead: it streams the file and writes the same
JSON, offline. Restart `pnpm run dev:mock` afterwards. Data © OpenStreetMap contributors (ODbL); canonical endpoints serve the small seed.
`@wn/*` packages must be built first (`npm run build` in `packages/contracts`,
`map-runtime`, `map-runtime-3d`).

## 3D end-to-end tests

```
npm run test:e2e:3d                      # builds the e2e bundle, serves it, runs Chromium (software WebGL)
E2E_PROD_URL=https://… npm run test:e2e:3d -- prod-smoke   # read-only smoke test of a deployed site
```

`playwright.3d.config.ts` runs against a **minified build** (`vite build --mode e2e`, see `.env.e2e`)
served by `vite preview`, so bundling issues (workers, CSS, chunks) are covered. Mock auth and the
`window.__networkMap` test hook are only compiled in for that mode; a `--mode production` build
strips mock auth as before. The backend is replaced by `page.route` stubs serving the generated Hanoi
payload (`e2e/.generated/full.json`, regenerated on every run). Set `PW_CHROMIUM_PATH` if your
installed Chromium differs from Playwright's pinned build. Basemap tiles are not needed.


---

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
