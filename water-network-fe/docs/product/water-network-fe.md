# water-network-fe — Initiative Notes

Initiative-level product notes cho frontend của nền tảng `water-network`.
Chi tiết thiết kế đầy đủ nằm ở
`docs/superpowers/specs/2026-06-15-water-network-fe-rewrite-design.md`.

## Goal

Rewrite frontend từ monolith `water-network-gis-fe` (Solid, kiến trúc tốt nhưng
phình scope + nguyên khối) sang **fleet micro-frontend**: mỗi MFE là một SPA độc
lập clone từ template chuẩn org `core-template/sampleapptanstack`, **khởi chạy từ
`app-catalog` cấp platform** (shell/launcher chung) + cross-app SSO (Keycloak),
dùng chung hợp đồng dữ liệu qua package npm `@wn/contracts`, khớp đúng REST/event
contract của `water-network-gis-be` (đã hoàn thành ở nơi khác).

> **Integration model:** fleet-SPA + **platform `app-catalog`** làm shell/SSO (xem
> `docs/decisions/0010-shell-platform-app-catalog.md`, amends 0009 — Menu App cục bộ
> đã bỏ). Module Federation đã bị loại.
>
> **Tenant/IAM contract:** theo
> [platform ADR 0010](../../../../platform-core/docs/decisions/0010-organization-first-tenant-context.md),
> Keycloak Organization là tenant; mỗi SPA giữ OIDC client riêng cho app/SSO; auth adapter
> normalize `organization[alias].tenant_id` thành tenant context phẳng. `tenant_apps` là quan hệ
> tenant↔app; không dùng client per-tenant `qlkd-*` cho tích hợp mới.

## Affected Product Areas

- **shell** — host: navigation, route guard RBAC, Keycloak auth shell, runtime
  config, feature flags.
- **gis** (`water-network-gis`) — Viewer + Editor (chung MFE để bảo toàn map continuity).
- **importer** (`water-network-importer`) — Spatial Importer (GeoJSON/KML/DXF, staging, provenance).
- **workflow** (`water-network-workflow`) — Review/Approve/Publish + Reference/lineage.
- **monitoring** (`water-network-monitoring`) — Reserved MiniApp (deferred).
- **simulation** (`water-network-simulation`) — Reserved MiniApp (deferred).
- **shared packages** — Reusable view logic lives in `@wn/*` packages
  (`@wn/contracts`, `@wn/map-runtime`, `@wn/ui`, `@wn/platform`), not the app
  slug. The deferred "Analytics MFE" dissolves into `monitoring`/`simulation`.

## Candidate Stories (epics)

| Story | Phase | Lane |
| --- | --- | --- |
| US-001 Foundation: monorepo + shared packages + shell | 0 | high-risk |
| US-002 GIS Core MFE (Viewer + Editor) | 1 | high-risk |
| US-003 Importer MFE | 2 | high-risk |
| US-004 Workflow + Reference MFE | 2 | high-risk |
| (deferred) Analytics MFE (PM suite, traces, topology graph) | 4 | backlog |

## Validation Shape

ESLint boundary rules + size budgets (chống phình), Vitest unit/component,
contract test khớp BE, Vitest integration per-MFE (standalone), Playwright
MF-integration + E2E journey (viewer↔editor continuity, import, review→publish),
axe a11y.

## Phasing

**FE-first, BE-last.** FE xây độc lập hoàn toàn với BE: auth = `mock`, dữ liệu =
MSW mock theo `@wn/contracts`. Tích hợp BE thật + Keycloak thật là **giai đoạn
riêng sau khi xong toàn bộ logic FE**. Các "Open Decisions" về IAM/registry/BE
dưới đây thuộc giai đoạn integration, **không chặn** việc build feature FE.

## Open Decisions (giai đoạn integration)

- Registry đích cho `@wn/contracts` (public npm vs private/Verdaccio).
- ~~Tên claim tenant (`tenant_id`/`org_id`)~~ — **đã chốt:** Organization context authoritative;
  auth adapter normalize Organization attribute `tenant_id` theo platform ADR 0010.
- ~~Realm/client IAM~~ — **đã chốt:** realm `water-platform`, một OIDC client riêng cho mỗi app;
  `azp` định danh app, không định danh tenant.
- Canonical CRS của `PublishedNetworkSnapshot` — runtime config.
- FE gọi thẳng BE hay qua API Gateway.
- Nhân lực squad FE (ảnh hưởng Phase 2 song song).

## Exit Criteria (MVP)

4 MFE chạy được qua shell với module federation; journey viewer↔editor,
import valid/invalid, review→approve→publish chạy thật với BE; lan can CI
(boundary + size + contract test) xanh; mỗi MFE chạy standalone được.

## Decision Record

- `docs/decisions/0008-fe-rewrite-architecture.md`

## SHW runtime (2026-09-14)

The isolated SHW deployment explicitly selects canonical tenant data and the rich
viewer. Empty tenants see an Import CAD action. Legacy `/full` remains a separate
seed contract and must never be used to populate SHW. See
[SHW runtime decision](../decisions/0011-shw-canonical-runtime.md).

## Map-centered CAD review (2026-09-15)

CAD is the main import workspace. Reviewers select geometry and use side panels for layers, symbols and quality. Alignment pairs a CAD point with a WGS84 map point. Incomplete pairs remain editable review data; server-validated geometry and independent checks are required for geographic output. See decision0012.

## Declared VN-2000 source coordinates (2026-09-15)

The alignment workbench also accepts a declared source CRS. Reviewers choose the
historical locality recorded in their survey, then explicitly choose provincial
TM-3 or VN-2000 UTM 48N/49N, coordinate order and metres/millimetres. The catalog
contains all 63 localities from TT26/2024 Annex 01; its `tt26-2024-*` identifiers
preserve that historical meaning. Current merged province names are not search
aliases, and no CRS is inferred from SHW, a filename or a province alone. Advanced
EPSG/PROJ entry remains available.

“Xem trên bản đồ” saves the interpretation and requests the worker's WGS84
preview. Raw CAD remains unchanged alongside it. An unconfirmed geographic
preview produces zero asset drafts; reviewers must inspect it and explicitly
save evidence before the existing quality, submission and approval gates apply.
Changing the source settings clears prior evidence. Switching from point pairs
or per-file CRS requires an explicit reversible reset. Saved presets reopen,
and conflict recovery hydrates the server revision and settings atomically.

See [decision 0013](../decisions/0013-vn2000-source-presets.md),
[design](../stories/SHW-VN2000-20260915/design.md) and
[pre-release validation](../stories/SHW-VN2000-20260915/validation.md).
