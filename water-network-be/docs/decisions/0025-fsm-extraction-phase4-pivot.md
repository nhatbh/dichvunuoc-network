# 0025 FSM extraction — Phase 4 (maintenance) nâng thành khối `water-fsm` nền tảng

Date: 2026-06-18

## Status

Accepted

## Context

Roadmap §10 dự kiến Phase 4 là `water-network-maintenance-be` — work order lifecycle
*nội bộ mạng lưới*, tiêu thụ `maintenance.work-order-requested` v1 (FROZEN ở INC-3,
decision 0024). Khi vào brainstorming MNT-1, yêu cầu sản phẩm làm rõ: WorkOrder phải là
năng lực **tổng hợp việc được giao của cả nền tảng** (sản xuất, kinh doanh, mạng lưới),
không chỉ mạng lưới.

Kiến trúc nền tảng đã có sẵn khái niệm này: **FSM (Field Service Management / "Giao việc
Hiện trường", Phân hệ F)** — "Grab nội bộ" nhận lệnh xuyên miền qua Event Bus
(PLATFORM.md §"Quan hệ giữa các khối"; `docs/architecture/khoi-3-kinh-doanh.md`).
`maintenance.work-order-requested` là **một trong N nguồn** cấp việc cho FSM.

## Decision

1. **Phase 4 (maintenance) của water-network được thay thế** bằng khối top-level riêng
   **`water-fsm/`** (.NET) — FSM xuyên miền. `water-network-maintenance-be` **không được
   tạo** trong water-network-be.

2. **Vai trò water-network = producer (đã hoàn thành).** incident-be phát
   `maintenance.work-order-requested` v1 (FROZEN, decision 0024). Không cần thay đổi phía
   network để FSM tiêu thụ — FSM dùng anti-corruption adapter map event này sang command
   canonical nội bộ.

3. **water-fsm self-contained**: vendor copy 9 building block từ
   `water-network-be/src/building-blocks`. Spec/plan FSM nằm trong `water-fsm/docs/superpowers/`;
   decision khối FSM trong `water-fsm/docs/decisions/`.

4. **Spec nguồn**: `water-fsm/docs/superpowers/specs/2026-06-18-fsm1-work-order-intake-lifecycle-design.md`.

## Consequences

- Roadmap §10 (`maintenance-be`) + §3.3 bảng Phase 4 + backlog "Phase 4 — Maintenance"
  được đánh dấu **superseded → moved to water-fsm khối** (cập nhật kèm decision này).
- Các slice MNT-1..3 cũ ánh xạ sang FSM khối: MNT-1 → FSM-1 (intake + lifecycle tối thiểu),
  MNT-2 (assign/schedule) → FSM-2, MNT-3 (repair/material) → FSM-3.
- Follow-up cũ "asset-be consume `work-order.completed` → gợi ý Activate" trở thành slice
  AST-x riêng (consume event do **FSM** phát, không phải maintenance-be).
- CIM-1 (customer-impact) vẫn consume `incident.isolation-plan-confirmed` từ network —
  không đổi.

## Deferred / Notes

- Hợp nhất building blocks vendored (water-fsm vs water-network vs platform-core/src/shared)
  thuộc nỗ lực chuẩn hoá platform riêng — không block FSM-1.
- Network bổ sung `Category` vào `maintenance.work-order-requested` (contract v2 non-breaking)
  để FSM khỏi default `PipeRepair` — follow-up khi nghiệp vụ cần phân loại việc chính xác.
