# Overview — US-001 Foundation

> Model: **fleet-SPA** per `docs/decisions/0009-fe-fleet-via-core-template.md`
> (amends 0008). Earlier Module Federation scaffold was parked.
>
> **Superseded (ADR 0010, 2026-06-17):** local Menu App đã bỏ — shell/launcher giờ
> là **`app-catalog` cấp platform**. `apps/menu` đã xoá; phần scaffold Menu App
> trong story này chỉ còn giá trị lịch sử.

## Current Behavior

`water-network-fe` chứa harness + docs nhưng **không có application code**. Tồn tại
sẵn một template chuẩn org `core-template/sampleapptanstack` (Solid + TanStack + FSD)
được thiết kế cho mô hình MiniApp fleet (Menu App + MiniApps clone từ template,
cross-app SSO qua Keycloak), nhưng chưa có app nào của water-network được dựng từ nó.

## Target Behavior

Nền tảng fleet-SPA chạy được:

- **`@wn/contracts`** — package npm publish được (Zod khớp BE), sống trong
  `water-network-fe`, build + test xanh, sẵn sàng cho các app cài.
- **Menu App** (`apps/menu`, port 3000) clone từ template — shell điều hướng +
  Keycloak `login-required` (mock ở Phase 0).
- **gis-core MiniApp** (`apps/gis-core`, port 3001) clone từ template — Keycloak
  `check-sso` (mock ở Phase 0), cài `@wn/contracts`, có một reference slice
  (snapshot entity) parse payload BE bằng contracts.

> Layout: các app đặt **trong `water-network-fe/apps/`** (theo yêu cầu human —
> "để trong water-network-fe"), mỗi app là project npm tự lập. (Ý ban đầu là
> sibling repos; đã đổi.)
- **Mốc nghiệm thu Phase 0**: từ Menu App điều hướng sang gis-core và SSO liền
  mạch (không hiện login lần hai); gis-core dùng được `@wn/contracts`; lan can CI
  của template (boundaries + size-limit + lint + test) xanh.

## Affected Users

- Đội FE (nền tảng cho mọi MiniApp sau).
- Gián tiếp: các vai trò RBAC (Viewer/Editor/Importer/Review/Approve/Publish).

## Affected Product Docs

- `docs/product/water-network-fe.md`
- `docs/decisions/0008-fe-rewrite-architecture.md` (amended)
- `docs/decisions/0009-fe-fleet-via-core-template.md`
- `docs/superpowers/specs/2026-06-15-water-network-fe-rewrite-design.md` (§3–§8,
  đọc qua lăng kính 0009)

## Non-Goals

- Domain features của gis-core/importer/workflow (Phase 1–2).
- Scaffold đủ cả importer + workflow ở Phase 0 (làm sau khi pattern chốt).
- Module Federation / runtime remote composition (đã loại ở 0009).
- Chốt open decisions: registry của `@wn/contracts`, tên claim tenant, gateway,
  canonical CRS — để chỗ cắm qua runtime config / `.env`.
- Publish `@wn/contracts` lên registry thật (chờ chốt registry) — Phase 0 chỉ cần
  build được + cài cục bộ (npm pack / file:).
