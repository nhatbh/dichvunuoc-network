# 0010 Shell = platform app-catalog; bỏ Menu App cục bộ (amends 0009)

Date: 2026-06-17

## Status

Accepted — amends `0009-fe-fleet-via-core-template.md` (thay thế lựa chọn "Menu
App làm fleet shell" của nó).

## Context

`0009` chốt mô hình fleet-SPA với một **Menu App** (clone từ
`core-template/sampleapptanstack`) làm shell: điều hướng cross-app + SSO Keycloak
(Menu dùng `login-required`, MiniApp dùng `check-sso`). `apps/menu` đã được
scaffold ở US-001.

Sau đó: nền tảng `water-platform` **đã có sẵn một menu tổng cấp platform —
"app-catalog"** — làm launcher/shell cho MiniApp của **mọi** domain, không riêng
water-network. Một Menu App cục bộ trong `water-network-fe` vì thế **trùng lặp**
với app-catalog và không cần thiết.

## Decision

1. **Bỏ Menu App cục bộ.** Xoá `apps/menu`. `water-network-fe` chỉ còn các MiniApp
   (`gis-core`, sau này `importer`, `workflow`…) + `@wn/contracts` + harness/docs.
2. **Shell/launcher = `app-catalog` cấp platform** (sống ngoài repo này). MiniApp
   được khởi chạy **từ app-catalog đi ra** — đó là điểm vào của toàn bộ fleet.
3. **Cơ chế SSO giữ nguyên** như 0009: shell (giờ là app-catalog) dùng
   `login-required`, MiniApp dùng `check-sso`; context cross-app qua URL params +
   Keycloak SSO. Code SSO shell↔miniapp trong gis-core
   (`shared/lib/cross-app-sso.ts`, `shared/config/env.ts`) **vẫn hợp lệ** —
   "shell" chỉ đổi danh tính từ Menu App → app-catalog.

## Giữ nguyên từ 0009

Fleet-SPA; mỗi MiniApp là SPA độc lập clone template, deploy độc lập; **không**
Module Federation; `@wn/contracts` published; **FE-first / BE-last** (auth mock +
MSW); Viewer + Editor chung `gis-core`.

## Consequences

Positive: bớt một app phải nuôi; không trùng menu với platform; tận dụng launcher
chung toàn nền tảng.

Tradeoffs: `water-network-fe` không tự chạy được luồng "shell → miniapp" độc lập
nữa — phải tích hợp với app-catalog ở **integration phase**. Việc retarget URL/SSO
của gis-core từ "Menu App" → app-catalog **hoãn tới integration phase** (đang mock
auth, **không phải blocker** FE work).

## Follow-Up (integration phase — không phải blocker FE)

- Retarget `cross-app-sso.ts` / `env.ts` của gis-core: "Menu App URL" → app-catalog
  entry.
- Chốt contract khởi chạy/handoff app-catalog ↔ MiniApp (URL scheme, SSO hint,
  return-nav).
- Đổi danh xưng "Menu App" → "app-catalog" trong `apps/gis-core/docs/cross-app-sso.md`
  và US-001 story khi đụng tới (đã đánh dấu superseded ở overview).
