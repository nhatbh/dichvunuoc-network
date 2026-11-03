# SHW quản lý bản đồ/hồ sơ mạng — MVP Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nghiệm thu ba hành trình tra cứu → biên tập → phê duyệt/xuất bản cho cán bộ SHW, trước khi chuẩn hóa nhân rộng.
**Architecture:** Giữ bounded contexts và APISIX hiện có. Chương trình được tách thành ba plan nhỏ theo dependency; mỗi plan có task, contract, RED/GREEN, command và evidence riêng. Index này không thay checkbox của các plan con.
**Tech Stack:** .NET 10/PostGIS/RabbitMQ/S3-compatible storage, SolidJS/OpenLayers, BFF/APISIX/K3s.
**Spec:** `../specs/2026-10-03-shw-network-records-mvp-completion-design.md` — **người dùng duyệt ngày 2026-10-03**.
**Status:** Approved — người dùng đồng ý cả ba plan và inline execution ngày 2026-10-03. Bắt đầu MVP01 Task1; workspace/SDK/baseline gates chưa đạt. Approval này không cho phép deploy, đổi quyền hoặc sửa dữ liệu vận hành SHW.

## Global Constraints

- Phục vụ SHW trước, sau đó chuẩn hóa và nhân rộng; không hard-code SHW vào core hoặc hạ chuẩn cách ly tenant.
- BFF là lớp proxy/read composition không database nghiệp vụ.
- FE chỉ gọi public BFF qua APISIX; GIS/Asset/Design ownership không đổi.
- Không làm lại tính năng chỉ vì checkbox cũ chưa tick; không công nhận hoàn tất chỉ vì checkbox đã tick.
- Không mutate SHW, đổi quyền, push/merge hoặc deploy nếu chưa có approval phù hợp.
- Không thêm OBS/HYD/CIM/FSM/reporting vào MVP này.

## Review Focus

Các plan con sở hữu test tương ứng: cursor/filter/tenant; late response/session; offscreen graph dependencies; self-approval/historical attribution; lost/duplicate completion và recovery. Trước release phải review toàn diff scope MVP, không chỉ commit mới nhất.

## Audit lập kế hoạch — read-only, không phải verification test

Snapshot Git dùng để lập kế hoạch: `b33b9104` + WIP hiện hành. BE feature baseline `ed5d409e`.

| Năng lực | Source hiện có | Gap phải xử lý / kiểm chứng | Plan/task |
|---|---|---|---|
| SDK/CI | root + BE pin 10.0.101; workflow service discovery/TRX có WIP | SDK availability/audit/discovery assertions chưa chạy lại | 01/1–2 |
| Canonical viewport | `map-page.tsx` có buffer và bbox-response guard | Rich map/assets còn dùng initial data; unified real search chưa thấy | 01/3–5 |
| Search/list | GIS Query folder không có SearchAssets; `screens/assets.tsx` cắt 200 | Server search/cursor + UI paging, fixture ≥10.000 | 01/3,5 |
| Hồ sơ/history | BFF overview route cũ; geometry_versions; node history | Public routes, malformed JSON degradation, all-kind history/tenant gate | 01/4–5 |
| Editor UI | WIP `network-editor/` có vẽ/modify/split/save và route riêng | `assets()` full tenant, local filtering100, cache no expiry, late async guards không bao mọi write-back | 02/1–2 |
| Quan hệ | GIS validator kiểm tra final graph; move node cập nhật loaded pipes | Offscreen dependencies, split point projection, connect existing node interior | 02/1,3 |
| CAS/save | Revision expectedVersion; repository CAS; submit khóa edit | Lifecycle request chưa có expectedVersion; mock lookup chưa đủ integration proof | 02/5 |
| Duyệt/audit | Actor trong transitions; permissions enforced | `Approve` chỉ check Submitted, chưa chặn self; revision chưa có creator | 02/4 |
| GIS publish | Serializable transaction, ledger, atomic batch receipt; tests redelivery/race có source | Receipt chỉ status/time; completion JSON chỉ outbox; thiếu result query | 03/1 |
| Design completion | Consumer lưu result rows rồi save revision | Cần atomic result/status; conflicting duplicate; lost completion reconciliation | 03/1 |
| Recovery/UI | Manual kiểm tra kết quả, error text | Per-op results, polling, failed-only new revision + idempotent recovery | 03/2–3 |
| Browser/release | E2E folder hiện có auth/login; historical rollout evidence | Real MVP journeys, fixture safety, restore/rollback, fresh SHW acceptance | 03/4–6 |

Môi trường phiên lập plan: `dotnet` không có trên PATH; GIS `node_modules` không có; FE Harness binary trả `Exec format error`. Không cài tool/dependency, không chạy product tests, không gọi cluster/SHW. Các quan sát trên không là kết luận pass/fail runtime. Harness query không chạy được được ghi ở đây; dùng Superpowers plan tracking, không tải binary mới trong phiên planning.

## Thứ tự và checkpoints

1. [ ] [MVP 01 — Baseline và tra cứu](2026-10-03-shw-mvp-01-baseline-read.md): **5 tasks**, có thể verified độc lập, chưa claim deployed/accepted.
2. [ ] [MVP 02 — Editor và phê duyệt](2026-10-03-shw-mvp-02-editor-approval.md): **5 tasks**, dùng read/scope/verifier của MVP01; migrations/approval ADR riêng.
3. [ ] [MVP 03 — Recovery và release](2026-10-03-shw-mvp-03-recovery-release.md): **6 tasks**, khép kín publish/restore/E2E và nghiệm thu.

Task implementation đầu tiên sau approval: **MVP01 Task1 — workspace + inventory + baseline verification**, không scaffold lại editor hay service.

Checkpoint kỹ thuật: search public contract trước FE; bounded edit closure trước geometry actions; attribution/CAS trước approval UI; durable receipts trước recovery. Có thể chuẩn bị fixture song song nhưng không dùng pending backend làm mock rồi tick source verified.

Checkpoint có side effect: trước move WIP sang worktree cần lựa chọn workspace; trước deploy/đổi quyền/mutation thật/push/merge phải xin approval riêng. Không auto deploy ngay sau suite GREEN.

## Các lựa chọn cần nhìn rõ khi duyệt plan

- Giữ SDK pin hiện tại để verify, không mặc định nâng band theo audit cũ.
- Search contains + cursor normalized code/kind/id; new defaults100/max500 là lựa chọn plan, không SLO đã đo.
- Không giữ localStorage draft recovery trong MVP; server persistence + dirty navigation warning là cam kết.
- Tách creator/latest submitter với reviewer; old missing creator không được backfill giả hoặc approve network edit mới âm thầm.
- Giữ atomic editor batch, CAD partial publish độc lập; recovery là revision mới liên kết source, không mở khóa terminal revision.
- Không retire legacy trong MVP; không triển khai platform-wide Organization cutover ngoài SHW scope.

## Spec coverage / self-review

| Spec section | Plan/tasks |
|---|---|
| Intent/baseline/scope/ownership | 01/1–2; mọi plan Global Constraints |
| Đọc, search, profile/history, counts, source degradation | 01/3–5 |
| CRS/quality/mandatory fields/provenance | 02/3,5; 03/4 CAD regression; 03/6 human source-data acceptance |
| Geometry/reference/CAS/save/reload/undo/session | 02/1–3,5 |
| Quyền, separation/audit | 02/4–5; public proxy tests01/4 và02/1 |
| Publish idempotency/partial/reconcile/failed retry | 03/1–3 |
| Backup/storage/config/restore/rollback/UAT | 01/1–2;03/5–6 |
| Evidence/state/release | 01/1 và completion mỗi plan;03/5–6 |
| Chuẩn hóa nhân rộng | Defer có chủ ý sau SHW accepted, không feature trong MVP |

Self-review lập plan: contract producer/consumer đã đối chiếu; legacy route/DTO giữ compatibility; task mới không gán green cho test chưa chạy. Implementation phải xác minh lại baseline WIP và ledger riêng từng plan; all task checkboxes giữ unchecked.
