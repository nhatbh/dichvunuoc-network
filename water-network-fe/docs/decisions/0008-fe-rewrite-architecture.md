# 0008 Frontend Rewrite Architecture (Micro-Frontend)

Date: 2026-06-15

## Status

Accepted — **amended by `0009-fe-fleet-via-core-template.md`**. The integration
model (Module Federation + pnpm/Turborepo monorepo + bespoke `@wn/*` MF
singletons) is superseded by the fleet-SPA model from `core-template`. The
rewrite-from-scratch strategy, Solid + Vite, anti-bloat discipline, bounded-context
contracts, and Viewer+Editor-in-one-app continuity remain in force.

## Context

`water-network-gis-fe` (Solid.js) là frontend GIS ban đầu. Khám phá codebase cho
thấy kiến trúc tốt (FSD, anti-corruption map layer, port-based API, 431 test)
nhưng sai "hình dạng triển khai": (1) phình scope — build nhiều tính năng
post-MVP; (2) nguyên khối — chưa có module federation, ngược mục tiêu
micro-frontend; (3) vài god-file (openlayers-adapter 2.327 dòng, viewer/editor
~1.6k/1.3k dòng). Backend `water-network-gis-be` (DDD/CQRS/ES) đã hoàn thành ở
nơi khác. Cần một định hướng FE chuẩn để phát triển độc lập nhiều surface.

## Decision

Rewrite frontend trong `water-network-fe` theo:

1. **Strategy**: rewrite from scratch, chắt lọc tri thức thiết kế đã chứng minh
   từ gis-fe (MapEnginePort, Zod contracts, port query/command) thay vì port
   nguyên trạng.
2. **Framework**: giữ Solid.js + Vite.
3. **Repo & integration**: monorepo (pnpm + Turborepo) + Module Federation
   (`@module-federation/vite`); shell host + remotes deploy độc lập.
4. **Integration model — Hybrid (C)**: shell sở hữu singleton cross-cutting
   (auth, QueryClient, design system, router shell, event bus); map runtime là
   package chung nhưng **mỗi MFE tự tạo map instance**; Viewer+Editor cùng MFE
   (gis-core) để chia sẻ map tự nhiên → bảo toàn continuity, tránh shared
   live-map xuyên remote.
5. **MVP scope**: 4 MFE — shell, gis-core, importer, workflow+reference.
6. **Advanced features**: hoãn sang MFE `analytics` riêng (phase sau).
7. **Anti-bloat**: ESLint boundary rules, size budgets, scope gate per MFE,
   contract test khớp BE — enforce trong CI từ Phase 0.

Chi tiết: `docs/superpowers/specs/2026-06-15-water-network-fe-rewrite-design.md`.

## Alternatives Considered

1. Tái cấu trúc & tái dùng code cũ (rủi ro thấp hơn) — bị loại: chủ đích muốn
   nền sạch.
2. Strangler Fig tại chỗ trên gis-fe — bị loại vì chọn nền mới.
3. Chuyển sang React — bị loại: giữ tri thức Solid của đội, performance map.
4. Polyrepo / monorepo deploy chung — bị loại: monorepo + MF cân bằng tốt nhất
   giữa độc lập và chia sẻ code.
5. Platform-core dày (B) / shell mỏng (A) — bị loại nghiêng về Hybrid (C).

## Consequences

Positive:

- Phát triển & deploy độc lập từng surface; chia sẻ code qua shared packages.
- Map continuity giải bằng đặt Viewer+Editor chung MFE.
- Lan can CI chặn phình tái diễn.

Tradeoffs:

- Rủi ro kỹ thuật Module Federation + Solid singleton (reactivity xuyên remote)
  → spike "hello remote" ở Phase 0.
- Bỏ ~160k dòng + 431 test của code cũ (giữ làm tham khảo).
- Chi phí hạ tầng MF cao hơn deploy chung.

## Follow-Up

- Chốt claim tenant với IAM; canonical CRS; FE↔BE qua gateway hay trực tiếp.
- Tạo stories US-001..US-004; spike MF+Solid singleton ngay Phase 0.
