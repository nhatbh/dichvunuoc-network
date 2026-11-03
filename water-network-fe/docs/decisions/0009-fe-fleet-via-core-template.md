# 0009 FE Fleet via core-template (amends 0008)

Date: 2026-06-15

## Status

Accepted — amends `0008-fe-rewrite-architecture.md` (supersedes its Module
Federation + monorepo integration choice).

Tenant/IAM follow-up của decision này đã được giải quyết bởi
[platform ADR 0010](../../../../platform-core/docs/decisions/0010-organization-first-tenant-context.md):
Organization = tenant; OIDC client riêng từng SPA = app/SSO; `tenant_apps` = entitlement.
Chỉ client per-tenant `qlkd-*` là legacy transition.

## Context

`0008` chốt **Module Federation + monorepo (pnpm+Turborepo) + bespoke `@wn/*`
packages** cho FE rewrite, và tự đánh dấu "MF + Solid singleton (reactivity xuyên
remote)" là **rủi ro #1**. Quyết định đó được đưa ra **mà không khảo sát
`core-template/sampleapptanstack`** — template chuẩn của org: *"Frontend Template —
Solid + TanStack + FSD"*, xây sẵn cho mô hình **MiniApp fleet** (README: "Each
backend domain (or bounded context) can ship as its own SPA cloned from this
template", Menu App + MiniApps + cross-app SSO).

Template trùng khớp stack mong muốn (Solid + Kobalte + Tailwind + TanStack Solid
Router/Query + Keycloak + FSD), đã có sẵn ~80% nội dung Phase 0 (auth facade,
eslint boundaries, size-limit, MSW, Sentry, web-vitals, event bus, runtime config,
scaffold.sh, Husky) và **đã được chứng minh**. Khác biệt cốt lõi: template dùng
**SPA độc lập + Menu shell điều hướng bằng URL + Keycloak `check-sso`**, KHÔNG dùng
Module Federation runtime → né hẳn rủi ro #1 của 0008.

## Decision

Chuyển sang **mô hình fleet-SPA dựa trên `core-template/sampleapptanstack`**:

1. Mỗi MFE (`gis-core`, `importer`, `workflow`) = **một SPA độc lập clone từ
   template** qua `scripts/scaffold.sh`, deploy độc lập, đặt **trong
   `water-network-fe/apps/<name>`** (vd `apps/gis-core`). Mỗi app vẫn là project
   npm tự lập (package.json + node_modules riêng, KHÔNG dùng workspace) — chỉ gom
   chung một repo cho dễ quản lý. (Cập nhật so với ý ban đầu "sibling repos" theo
   yêu cầu của human: để trong water-network-fe.)
2. **Menu App** (cũng clone từ template) làm shell: điều hướng cross-app + **SSO
   liền mạch qua Keycloak `check-sso`** (Menu dùng `login-required`, MiniApp dùng
   `check-sso`) — thay cho Module Federation host.
3. **Không Module Federation, không shared live singleton xuyên app.** Giao tiếp
   cross-app = URL params + Keycloak SSO (+ event bus trong từng app).
4. Stack theo template: Vite 5 + Solid 1.9 + Kobalte + Tailwind + TanStack Solid
   Router (file-based) + Solid Query + Keycloak facade (mock/keycloak/
   backend-session) + FSD + eslint-plugin-boundaries + size-limit + MSW + Sentry +
   web-vitals.
5. **`@wn/contracts`** (Zod khớp BE) = **npm package được publish**, sống trong
   `water-network-fe`, mỗi app cài như dependency. Registry đích = open item.
6. `water-network-fe` = **harness/docs/product brain + nhà của `@wn/contracts`**,
   không còn là monorepo app.

## Giữ nguyên từ 0008

Rewrite-from-scratch; Solid + Vite; kỷ luật chống phình (boundary + size + scope
gate — template đã enforce); contracts tổ chức theo bounded context của BE;
**Viewer + Editor chung một app (gis-core)** để bảo toàn map continuity (vẫn đúng:
gis-core là một SPA).

## Thay đổi so với 0008

- Module Federation host/remote → **fleet SPA độc lập + Menu App SSO**.
- pnpm + Turborepo monorepo → **app npm độc lập (sibling repos) + `@wn/contracts`
  published**.
- `@wn/platform` / `@wn/ui` / `@wn/map-runtime` dưới dạng MF singleton → dùng
  `shared/` + auth facade của template; `@wn/contracts` published. (`@wn/map-runtime`
  có thể trở thành package published riêng ở Phase 1 — chốt sau.)

## Alternatives Considered

1. **Giữ Module Federation thuần (0008)** — bị loại: phát minh lại hạ tầng đã
   chứng minh, gánh nguyên rủi ro #1, lệch chuẩn org.
2. **Hybrid: MF + mượn mảnh template** — bị loại: vẫn gánh rủi ro MF+singleton để
   đổi lấy lợi ích nhỏ; phức tạp hơn fleet-SPA.

## Consequences

Positive: tái dùng hạ tầng đã chứng minh; **khử rủi ro #1**; đúng chuẩn org;
Phase 0 nhanh hơn nhiều; mỗi app deploy độc lập tự nhiên.

Tradeoffs: mất khả năng ghép remote vào *cùng một trang* lúc runtime (chấp nhận —
continuity nằm trong từng app); state cross-app chỉ qua URL/SSO/event; shared code
cần luồng publish registry; nhiều app trong một repo (mỗi app npm tự lập) cần
convention chung về port/env/deploy.

## Follow-Up

**Phasing (chốt với human): FE-first, BE-last.** Toàn bộ FE xây **độc lập hoàn
toàn với BE** — auth giữ `VITE_AUTH_MODE=mock`, dữ liệu qua MSW mock theo
`@wn/contracts`. Chỉ khi **xong toàn bộ logic FE** mới mở **giai đoạn integration
riêng** để cắm BE thật + Keycloak thật. Do đó các mục dưới **không phải blocker**
của feature work FE:

- Registry đích cho `@wn/contracts` (public npm vs private/Verdaccio) — tạm `file:`.
- Keycloak: **đã chốt** realm `water-platform`, client riêng từng app, `check-sso`; tenant lấy từ
  Organization context đã verify/normalize theo platform ADR 0010, không lấy từ `azp` hay client
  per-tenant.
- Đấu BE thật: base URL/gateway + contract test khớp sample payload BE.
- Chiến lược share `@wn/map-runtime` (published package vs copy).
