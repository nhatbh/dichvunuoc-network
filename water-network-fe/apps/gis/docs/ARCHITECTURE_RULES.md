# Architecture Rules

**Version:** 2.0.0 (Solid SPA)  
**Status:** Source of truth for AI agents and contributors

---

## Stack (actual)

| Layer                | Technology                                                            |
| -------------------- | --------------------------------------------------------------------- |
| UI                   | SolidJS 1.9, Kobalte, Tailwind CSS                                    |
| Routing              | TanStack Solid Router (file-based, SPA)                               |
| Server state         | TanStack Solid Query                                                  |
| Forms                | @modular-forms/solid + Zod                                            |
| Auth                 | Pluggable: `mock`, `keycloak`, `backend-session` via `client-auth.ts` |
| Cross-feature events | `mitt` event bus                                                      |
| Client UI state      | Solid signals / `@solid-primitives/storage` stores                    |
| Build                | Vite 5, TypeScript strict                                             |

This is a **UI-only** frontend microservice: no embedded BFF in this repo. APIs live behind your gateway or domain services.

---

## FSD layers

```
src/
├── app/           # Shell, providers, global CSS
├── pages/         # Route compositions (no business logic)
├── widgets/       # Optional large blocks (add when needed)
├── features/      # User actions, orchestration
├── entities/      # Domain data + presentational UI
├── shared/        # API, UI kit, config, utils
├── routes/        # Thin TanStack route files
└── routeTree.gen.ts
```

### Dependency flow

```
app → pages → widgets → features → entities → shared
```

| Layer      | May import                                   |
| ---------- | -------------------------------------------- |
| `app`      | `shared`                                     |
| `pages`    | `widgets`, `features`, `entities`, `shared`  |
| `widgets`  | `features`, `entities`, `shared`             |
| `features` | **same feature slice**, `entities`, `shared` |
| `entities` | `shared`                                     |
| `shared`   | external packages only                       |

**Forbidden:** feature → other feature, entity → entity, lower → higher layer.

Enforced by `eslint-plugin-boundaries` + `import/no-restricted-paths` (see `eslint.config.mjs`).

---

## Reference vertical slice

Clone this pattern for new domains:

| Piece          | Path                                               |
| -------------- | -------------------------------------------------- |
| Entity types   | `src/entities/sample-item/model/types.ts`          |
| Entity API     | `src/entities/sample-item/api/queries.ts`          |
| Entity UI      | `src/entities/sample-item/ui/sample-item-card.tsx` |
| Feature action | `src/features/refresh-sample-items/`               |
| Page           | `src/pages/sample-items/index.tsx`                 |
| Route + guard  | `src/routes/sample-items.tsx`                      |
| Query keys     | `src/shared/api/query-keys.ts`                     |
| MSW            | `src/shared/api/mocks/handlers.ts`                 |

---

## Data flow

```
User action → Page → Feature UI → Feature model
  → Entity API (queryOptions) → httpClient → backend
  → optional Event Bus → query invalidation → UI update
```

### TanStack Query

- Define `queryOptions()` in `entities/*/api/`.
- Centralize keys in `src/shared/api/query-keys.ts`.
- Use `useQuery(() => options)` in Solid components.

### Event bus

Features must not import each other. Emit/listen via `@/shared/lib/events`.

---

## HTTP client

- Default: `httpClient` → `VITE_API_URL` (gateway or primary service).
- Multi-service: `createHttpClient({ baseURL })` or `secondaryHttpClient`.
- **Keycloak / mock:** Bearer token on requests.
- **backend-session:** `credentials: 'include'`, no Bearer — see `docs/backend-session-bff.md`.

---

## Auth

Single entry: `src/shared/lib/client-auth.ts`.

| Mode              | Use case                        |
| ----------------- | ------------------------------- |
| `mock`            | Local dev                       |
| `keycloak`        | Fleet SSO (Menu App + MiniApps) |
| `backend-session` | BFF httpOnly cookies            |

Route guards: `authGuard`, `roleGuard`, `permissionGuard` in `src/shared/lib/route-guards.ts`.

---

## Routing

- Routes in `src/routes/*.tsx` — lazy-load pages, `beforeLoad` for guards.
- Regenerate: `npm run routes:generate`.
- No SSR in this template (static SPA + nginx).

---

## Runtime config

Deploy-time overrides without rebuild:

1. Copy `public/config.json.example` → `public/config.json`
2. Set `VITE_USE_RUNTIME_CONFIG=true`
3. Bootstrap loads config in `src/bootstrap.ts` before render

---

## Naming

- Files: `kebab-case.ts` / `kebab-case.tsx`
- Components: `PascalCase` in PascalCase files
- Hooks: `useCamelCase`
- Constants / event keys: `UPPER_SNAKE_CASE`

---

## Testing

- Unit: Vitest + `@solidjs/testing-library` (co-located `*.test.ts`)
- E2E: Playwright in `e2e/`
- MSW: `VITE_USE_MOCK_DATA=true` + `npx msw init public/ --save`

---

## Related docs

- [`docs/cross-app-sso.md`](./cross-app-sso.md)
- [`docs/auth-keycloak.md`](./auth-keycloak.md)
- [`docs/backend-session-bff.md`](./backend-session-bff.md)
- [`docs/EVENT_BUS_GUIDE.md`](./EVENT_BUS_GUIDE.md)
