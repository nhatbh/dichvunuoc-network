# Design — US-001 Foundation

> Model: **fleet-SPA** (decision 0009), dựa trên `core-template/sampleapptanstack`.

## Domain Model

Phase 0 không sở hữu domain GIS. Tầng nền:

- `@wn/contracts` — Zod schemas khớp DTO của BE, theo bounded context
  (`common/`, `snapshot/`, …). Floor dependency, không phụ thuộc app.
- Auth/RBAC do **auth facade của template** (`src/shared/lib/client-auth.ts`)
  cung cấp: `IUserContext` từ Keycloak, RBAC guard qua TanStack Router
  `beforeLoad` + `authGuard()`.

## Application Flow (fleet)

```
Keycloak realm (vd techgen)
   │  login-required
   ▼
Menu App (../water-network-menu, :3000)
   │  navigateToMiniApp('https://gis-core/...')   ← URL navigation
   ▼
gis-core MiniApp (../water-network-gis-core)
   │  keycloak.init({ onLoad: 'check-sso' }) → silent iframe → đã đăng nhập
   ▼
Component → TanStack Solid Query → httpClient (template shared/)
   → /api/water-network-gis/v1/* (BE)
   → Zod parse (@wn/contracts) → render
```

Không có shared live singleton xuyên app. Cross-app = URL + Keycloak SSO; trong
app dùng event bus + signals + Query (theo template).

## Interface Contract

- **Scaffold**: `core-template/sampleapptanstack/scripts/scaffold.sh <name>
  <target>` (rsync template, đổi tên package, copy `.env.example`→`.env`). Target
  đặt trong `water-network-fe/apps/<name>` (đã scaffold `apps/menu`, `apps/gis-core`).
- **Config-driven** (`.env`, theo `core-template/.env.example`):
  - Menu: `VITE_AUTH_MODE=keycloak`, `VITE_KEYCLOAK_ON_LOAD=login-required`,
    `VITE_KEYCLOAK_*`, `VITE_API_URL`.
  - MiniApp: `VITE_KEYCLOAK_ON_LOAD=check-sso`,
    `VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI=…/silent-check-sso.html`,
    `VITE_MENU_APP_URL=…`.
- **Routing**: TanStack Solid Router file-based (`src/routes/*`), guard bằng
  `beforeLoad` + `authGuard()`. Deep-link giữ tương thích ngược khi build feature.
- **Contracts**: app cài `@wn/contracts` (+ peer `zod`); import theo bounded
  context (`@wn/contracts/snapshot`).

## Data Model

Không DB ở FE. `@wn/contracts` là hợp đồng dữ liệu (đã build dist js+d.ts).
Phase 0 ship `common/` + `snapshot/`; thêm context khi build từng MiniApp.

## UI / Platform Impact

- Mỗi app là SPA Vite độc lập (port 3000 mặc định template), deploy nginx riêng
  (Dockerfile/nginx.conf template), health `GET /health`.
- UI kit: Kobalte + Tailwind + CVA của template.
- SSO dựa cookie iframe (`check-sso`) — lưu ý third-party cookie (xem
  `core-template/docs/cross-app-sso.md`): khác TLD cần `login-required`.

## Observability

Sentry + web-vitals đã tích hợp sẵn trong template; mỗi app tự cấu hình DSN qua
`.env`.

## Anti-bloat

Kế thừa từ template: eslint-plugin-boundaries (FSD layers), size-limit budgets
(entry ≤120KB, css ≤50KB), Husky + lint-staged. Thêm `SCOPE.md` per app khi build
feature (Phase 1–2).

## Shared `@wn/contracts` — chiến lược phân phối

- Quyết định: **published npm package**. Registry đích = open item (public npm vs
  private/Verdaccio).
- Phase 0 (chưa có registry): app tiêu thụ qua `file:../../packages/contracts`
  (đang dùng ở `apps/gis-core`) để chứng minh luồng; đổi sang bản registry khi hạ
  tầng sẵn sàng.

## Alternatives Considered

1. **Module Federation (0008)** — loại ở 0009 (rủi ro #1, lệch chuẩn org).
2. **Copy contracts vào mỗi app** — loại: trùng lặp, dễ lệch hợp đồng với BE.
3. **gis-core trước, đủ fleet sau** — vẫn khả dĩ; layout đã chốt sibling repos,
   Phase 0 làm Menu + gis-core trước rồi mở rộng.
